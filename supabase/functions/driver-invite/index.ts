import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Missing auth header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: me } = await userClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { email, fullName } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(fullName || '').trim();
    if (!normalizedEmail || !normalizedName) return new Response(JSON.stringify({ error: 'Name and email are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const adminClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const { error: inviteRowError } = await adminClient.from('driver_invites').upsert({
      email: normalizedEmail,
      full_name: normalizedName,
      invited_by: user.id,
      invited_at: new Date().toISOString(),
      used_at: null,
    }, { onConflict: 'email' });
    if (inviteRowError) throw inviteRowError;

    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
    const redirectTo = `${siteUrl}/driver-signup.html?email=${encodeURIComponent(normalizedEmail)}`;

    const { error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: { full_name: normalizedName, role: 'driver' },
      redirectTo,
    });
    if (authInviteError) throw authInviteError;

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Invite failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
