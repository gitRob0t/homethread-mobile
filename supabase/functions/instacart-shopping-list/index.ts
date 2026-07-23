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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const instacartKey = Deno.env.get('INSTACART_API_KEY');
    const instacartBaseUrl = Deno.env.get('INSTACART_BASE_URL') || 'https://connect.instacart.com';
    if (!supabaseUrl || !anonKey) return json({ error: 'Coho is not configured.' }, 503);
    if (!instacartKey) {
      return json({
        error: 'Instacart production access is not configured yet.',
        code: 'provider_not_configured',
      }, 503);
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required.' }, 401);
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Invalid session.' }, 401);

    const body = await request.json();
    const householdId = String(body?.householdId ?? '');
    if (!householdId) return json({ error: 'A household is required.' }, 400);

    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('household_id', householdId)
      .eq('user_id', authData.user.id)
      .maybeSingle();
    if (!membership) return json({ error: 'Household access denied.' }, 403);

    const [{ data: household }, { data: items, error: itemsError }] = await Promise.all([
      supabase.from('households').select('name').eq('id', householdId).single(),
      supabase
        .from('grocery_items')
        .select('name, quantity')
        .eq('household_id', householdId)
        .eq('checked', false)
        .order('created_at', { ascending: true })
        .limit(100),
    ]);
    if (itemsError) throw itemsError;
    if (!items?.length) return json({ error: 'Your shared grocery list has no unchecked items.' }, 400);

    const providerResponse = await fetch(`${instacartBaseUrl}/idp/v1/products/products_link`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${instacartKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `${household?.name || 'Coho'} grocery list`,
        link_type: 'shopping_list',
        expires_in: 7,
        line_items: items.map((item) => ({
          name: item.name,
          display_text: [item.quantity, item.name].filter(Boolean).join(' '),
        })),
        landing_page_configuration: {
          enable_pantry_items: true,
        },
      }),
    });
    const providerPayload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) {
      console.error('Instacart request failed', providerResponse.status, providerPayload);
      return json({ error: 'Instacart could not create the shopping list.' }, 502);
    }

    const url = String(providerPayload?.products_link_url ?? '');
    if (!/^https:\/\/([a-z0-9-]+\.)*instacart\.com\//i.test(url)) {
      return json({ error: 'Instacart returned an invalid shopping link.' }, 502);
    }
    return json({ url, itemCount: items.length });
  } catch (error) {
    console.error('Instacart shopping list error', error);
    return json({ error: 'The shopping link could not be created.' }, 500);
  }
});
