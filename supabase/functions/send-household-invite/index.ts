import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safe(value: unknown, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Invitation delivery is not configured.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (request.method === 'GET') {
    const token = safe(new URL(request.url).searchParams.get('token'), 128);
    if (!/^[a-f0-9]{48}$/i.test(token)) return invitePage('This invitation link is invalid.', 400);
    const tokenHash = await sha256(token);
    const { data: invitation } = await admin
      .from('invitations')
      .select('status, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (!invitation || invitation.status !== 'pending' || new Date(invitation.expires_at) <= new Date()) {
      return invitePage('This invitation has expired or was already used.', 410);
    }

    // The user already tapped an HTTPS invitation link, so a server redirect is
    // more reliable than serving an HTML page that some mobile browsers and
    // messaging clients display as literal source text.
    return new Response(null, {
      status: 302,
      headers: {
        Location: `coho://invite/${token}`,
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session.' }, 401);

  try {
    const body = await request.json();
    const householdId = safe(body?.householdId, 80);
    const email = safe(body?.email, 320).toLowerCase();
    const invitedName = safe(body?.name, 100) || null;
    const role = ['admin', 'member', 'child'].includes(body?.role) ? body.role : 'member';
    if (!householdId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: 'A household and valid email are required.' }, 400);
    }

    const { data: created, error: createError } = await client.rpc('create_household_invitation', {
      target_household: householdId,
      target_email: email,
      target_role: role,
    });
    if (createError) throw createError;
    const invitation = created?.[0];
    if (!invitation?.invitation_id || !invitation?.invitation_token) {
      throw new Error('The invitation could not be created.');
    }

    const [{ data: household }, { data: inviter }] = await Promise.all([
      client.from('households').select('name').eq('id', householdId).single(),
      client.from('profiles').select('display_name').eq('id', authData.user.id).single(),
    ]);
    await admin.from('invitations').update({ invited_name: invitedName })
      .eq('id', invitation.invitation_id);

    const inviteUrl =
      `${supabaseUrl}/functions/v1/send-household-invite?token=${invitation.invitation_token}`;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('COHO_FROM_EMAIL');
    let emailSent = false;
    let deliveryError: string | null = null;
    if (resendKey && from) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `${inviter?.display_name || 'Your family'} invited you to Coho`,
          text: [
            `${inviter?.display_name || 'A family member'} invited you to join ${household?.name || 'their household'} on Coho.`,
            '',
            `Open this secure invitation: ${inviteUrl}`,
            '',
            'Sign in with this email address. The invitation expires in 7 days.',
          ].join('\n'),
          html: invitationEmail({
            inviter: inviter?.display_name || 'A family member',
            household: household?.name || 'their household',
            inviteUrl,
          }),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      emailSent = response.ok;
      deliveryError = response.ok ? null : safe(payload?.message || payload?.name || 'Email provider rejected the invitation.', 500);
    } else {
      deliveryError = 'Email delivery is not configured; share the secure link instead.';
    }
    await admin.from('invitations').update({
      delivery_status: emailSent ? 'sent' : 'failed',
      last_delivery_error: deliveryError,
    }).eq('id', invitation.invitation_id);

    return json({
      invitationId: invitation.invitation_id,
      invitationToken: invitation.invitation_token,
      inviteUrl,
      emailSent,
      deliveryError,
    });
  } catch (error) {
    console.error('Household invitation error', error);
    const failure = invitationFailure(error);
    return json({ error: failure.message, code: failure.code }, failure.status);
  }
});

function invitationFailure(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('gen_random_bytes') || normalized.includes('function digest')) {
    return {
      status: 503,
      code: 'backend_update_required',
      message: 'Coho’s secure invitation service needs the latest database update.',
    };
  }
  if (normalized.includes('only household administrators')) {
    return {
      status: 403,
      code: 'household_admin_required',
      message: 'Only a household administrator can invite family members.',
    };
  }
  if (normalized.includes('valid email') || normalized.includes('email address is required')) {
    return {
      status: 400,
      code: 'invalid_email',
      message: 'Enter a valid email address.',
    };
  }
  return {
    status: 500,
    code: 'invitation_create_failed',
    message: 'The secure invitation could not be created. Please retry.',
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function invitePage(title: string, status = 200) {
  const safeTitle = escapeHtml(title);
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>
body{margin:0;background:#0e1728;color:#fff;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center}
main{max-width:520px;margin:24px;padding:36px;border:1px solid #34415b;border-radius:28px;background:#172238;text-align:center}
.mark{width:72px;height:72px;border-radius:24px;margin:auto;display:grid;place-items:center;background:linear-gradient(135deg,#2257f4,#7047ee);font-size:32px}
h1{font-size:30px;margin:22px 0 10px}.muted{color:#b8c1d3;line-height:1.5}
</style></head><body><main><div class="mark">✦</div><h1>${safeTitle}</h1>
<p class="muted">Ask the household owner to send a new secure invitation.</p>
</main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

function invitationEmail(input: { inviter: string; household: string; inviteUrl: string }) {
  return `<div style="background:#f4f6fb;padding:32px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#182033">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:24px;padding:32px">
    <div style="font-size:34px">✦</div>
    <h1 style="margin:18px 0 8px">Your family is waiting in Coho.</h1>
    <p style="line-height:1.6;color:#5f687a">${escapeHtml(input.inviter)} invited you to join <strong>${escapeHtml(input.household)}</strong>. You’ll see the same calendar, assignments, Family Inbox, and updates immediately.</p>
    <a href="${escapeHtml(input.inviteUrl)}" style="display:block;background:#2257f4;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:14px;font-weight:800;margin-top:24px">Join the household</a>
    <p style="font-size:13px;line-height:1.5;color:#7e8798;margin-top:22px">For your privacy, sign in with the exact email address that received this invitation. This secure link expires in 7 days.</p>
  </div></div>`;
}
