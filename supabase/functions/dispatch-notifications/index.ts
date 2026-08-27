import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };
const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function retryAt(attempts: number) {
  const delayMinutes = Math.min(360, Math.max(1, 2 ** Math.max(0, attempts - 1)));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function preferenceAllows(item: any, preferences: any) {
  if (!preferences) return true;
  if (item.channel === 'push' && preferences.push_delivery === false) return false;
  if (item.category === 'daily') return preferences.daily_recap !== false;
  if (item.category === 'week_ahead') return preferences.week_ahead !== false;
  if (item.category === 'follow_up') return preferences.follow_up !== false;
  if (item.category === 'family_message') return preferences.messages !== false;
  if (item.category === 'reminder') return preferences.event_reminders !== false;
  if (item.category === 'assignment') {
    return item.payload?.kind === 'chore' || item.payload?.kind === 'task'
      ? preferences.chore_reminders !== false
      : preferences.event_reminders !== false;
  }
  return true;
}

function localMinutes(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return (hour * 60) + minute;
}

function clockMinutes(value: unknown, fallback: number) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return ((Number(match[1]) % 24) * 60) + Number(match[2]);
}

function isQuietTime(item: any, preferences: any) {
  if (!preferences?.quiet_hours || item.payload?.urgent === true) return false;
  try {
    const now = localMinutes(preferences.timezone || 'UTC');
    const start = clockMinutes(preferences.quiet_hours_start, 21 * 60);
    const end = clockMinutes(preferences.quiet_hours_end, 7 * 60);
    if (start === end) return true;
    return start < end ? now >= start && now < end : now >= start || now < end;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Notification delivery is not configured.' }, 503);

  const authorization = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (authorization !== serviceKey && (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret)) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    await settleExpoReceipts(supabase);
    const { data: claimed, error } = await supabase.rpc('claim_notification_batch', {
      batch_size: 100,
    });
    if (error) throw error;
    if (!claimed?.length) return json({ dispatched: 0, message: 'No notifications due.' });

    const recipientIds = [...new Set(claimed.map((item: any) => item.recipient_user_id))];
    const [{ data: tokens }, { data: preferenceRows }] = await Promise.all([
      supabase
        .from('device_push_tokens')
        .select('id, user_id, expo_push_token')
        .in('user_id', recipientIds)
        .eq('enabled', true),
      supabase
        .from('notification_preferences')
        .select('user_id, daily_recap, event_reminders, chore_reminders, messages, week_ahead, follow_up, push_delivery, email_copy, quiet_hours, quiet_hours_start, quiet_hours_end, timezone')
        .in('user_id', recipientIds),
    ]);
    const preferences = new Map((preferenceRows ?? []).map((row: any) => [row.user_id, row]));
    const tokensByUser = new Map<string, any[]>();
    for (const token of tokens ?? []) {
      tokensByUser.set(token.user_id, [...(tokensByUser.get(token.user_id) ?? []), token]);
    }

    const pushDeliveries: Array<{ outbox: any; token: any; message: any }> = [];
    const emailDeliveries: any[] = [];
    for (const item of claimed) {
      const recipientPreferences = preferences.get(item.recipient_user_id);
      if (!preferenceAllows(item, recipientPreferences)) {
        await supabase.from('notification_outbox').update({
          status: 'canceled',
          last_error: 'Disabled by notification preferences.',
        }).eq('id', item.id);
        continue;
      }
      if (isQuietTime(item, recipientPreferences)) {
        await supabase.from('notification_outbox').update({
          status: 'queued',
          attempts: Math.max(0, Number(item.attempts ?? 1) - 1),
          next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          last_error: 'Deferred by quiet hours.',
        }).eq('id', item.id);
        continue;
      }
      if (item.channel === 'email') {
        emailDeliveries.push(item);
        continue;
      }
      const recipientTokens = tokensByUser.get(item.recipient_user_id) ?? [];
      if (!recipientTokens.length) {
        await markFailed(supabase, item, 'No active push device is registered.');
        continue;
      }
      for (const token of recipientTokens) {
        pushDeliveries.push({
          outbox: item,
          token,
          message: {
            to: token.expo_push_token,
            title: item.title,
            body: item.body,
            sound: 'default',
            data: {
              ...(item.payload ?? {}),
              notificationId: item.id,
              deepLink: item.deep_link,
            },
          },
        });
      }
    }

    for (const batch of chunks(pushDeliveries, 100)) {
      const response = await fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch.map((delivery) => delivery.message)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        for (const delivery of batch) {
          await markFailed(supabase, delivery.outbox, `Expo send failed (${response.status}).`);
        }
        continue;
      }

      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      const grouped = new Map<string, { outbox: any; ticketIds: string[]; errors: string[] }>();
      batch.forEach((delivery, index) => {
        const ticket = tickets[index] ?? {};
        const current = grouped.get(delivery.outbox.id) ?? {
          outbox: delivery.outbox,
          ticketIds: [],
          errors: [],
        };
        if (ticket.status === 'ok' && ticket.id) current.ticketIds.push(ticket.id);
        else {
          const message = String(ticket?.message ?? ticket?.details?.error ?? 'Push provider rejected the message.');
          current.errors.push(message);
          if (ticket?.details?.error === 'DeviceNotRegistered') {
            await supabase.from('device_push_tokens').update({ enabled: false }).eq('id', delivery.token.id);
          }
        }
        grouped.set(delivery.outbox.id, current);
      });

      for (const delivery of grouped.values()) {
        if (delivery.ticketIds.length) {
          await supabase.from('notification_outbox').update({
            status: 'sent',
            provider_message_id: delivery.ticketIds[0],
            payload: {
              ...(delivery.outbox.payload ?? {}),
              expoTicketIds: delivery.ticketIds,
            },
            last_error: delivery.errors.length ? delivery.errors.join(' | ').slice(0, 1_000) : null,
            sent_at: new Date().toISOString(),
          }).eq('id', delivery.outbox.id);
        } else {
          await markFailed(supabase, delivery.outbox, delivery.errors.join(' | ') || 'No push ticket was accepted.');
        }
      }
    }

    for (const item of emailDeliveries) {
      await deliverEmail(supabase, item);
    }
    return json({ dispatched: claimed.length });
  } catch (error) {
    console.error('Notification dispatch failed', error);
    return json({ error: 'Notification dispatch failed.' }, 500);
  }
});

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  item: any,
  message: string,
) {
  const terminal = Number(item.attempts ?? 0) >= Number(item.max_attempts ?? 5);
  await supabase.from('notification_outbox').update({
    status: terminal ? 'canceled' : 'failed',
    next_attempt_at: retryAt(Number(item.attempts ?? 1)),
    last_error: message.slice(0, 1_000),
  }).eq('id', item.id);
}

async function deliverEmail(
  supabase: ReturnType<typeof createClient>,
  item: any,
) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('COHO_FROM_EMAIL');
  if (!resendKey || !from) {
    await markFailed(supabase, item, 'Email delivery is not configured.');
    return;
  }
  const { data } = await supabase.auth.admin.getUserById(item.recipient_user_id);
  const email = data.user?.email;
  if (!email) {
    await markFailed(supabase, item, 'The recipient has no verified email address.');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: item.title,
      text: `${item.body}\n\nOpen in Coho: ${item.deep_link}`,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await markFailed(supabase, item, `Email provider failed (${response.status}).`);
    return;
  }
  await supabase.from('notification_outbox').update({
    status: 'sent',
    provider_message_id: payload?.id ?? null,
    sent_at: new Date().toISOString(),
    last_error: null,
  }).eq('id', item.id);
}

async function settleExpoReceipts(supabase: ReturnType<typeof createClient>) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: rows } = await supabase
    .from('notification_outbox')
    .select('id, recipient_user_id, payload')
    .eq('status', 'sent')
    .lt('sent_at', cutoff)
    .limit(250);
  const tickets = (rows ?? []).flatMap((row: any) =>
    Array.isArray(row.payload?.expoTicketIds)
      ? row.payload.expoTicketIds.map((ticketId: string) => ({ ticketId, row }))
      : [],
  );
  if (!tickets.length) return;

  for (const batch of chunks(tickets, 1000)) {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ ids: batch.map((item) => item.ticketId) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) continue;
    const receiptMap = payload?.data ?? {};
    const rowsById = new Map<string, any>();
    for (const item of batch) {
      const receipt = receiptMap[item.ticketId];
      if (!receipt) continue;
      const current = rowsById.get(item.row.id) ?? { row: item.row, delivered: false, errors: [] };
      if (receipt.status === 'ok') current.delivered = true;
      else current.errors.push(String(receipt?.message ?? receipt?.details?.error ?? 'Push receipt failed.'));
      rowsById.set(item.row.id, current);
    }
    for (const result of rowsById.values()) {
      if (result.delivered) {
        await supabase.from('notification_outbox').update({
          status: 'delivered',
          last_error: result.errors.length ? result.errors.join(' | ').slice(0, 1_000) : null,
        }).eq('id', result.row.id);
        await supabase.from('notification_receipts').upsert({
          notification_id: result.row.id,
          user_id: result.row.recipient_user_id,
          receipt_type: 'delivered',
          metadata: { provider: 'expo' },
        }, { onConflict: 'notification_id,user_id,receipt_type' });
      }
    }
  }
}
