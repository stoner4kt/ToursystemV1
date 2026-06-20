import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getSiteUrl(req: Request) {
  const configured = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  if (configured) return configured;

  const origin = req.headers.get('origin');
  if (origin) return origin.replace(/\/$/, '');

  const referer = req.headers.get('referer');
  if (referer) return new URL(referer).origin.replace(/\/$/, '');

  return '';
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Driver invite function is missing Supabase environment variables.' }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: me, error: profileError } = await userClient
      .from('profiles')
      .select('id,role')
      .eq('id', user.id)
      .maybeSingle();

    const metadataRole = user.app_metadata?.role || user.user_metadata?.role;
    const configuredAdminEmail = (Deno.env.get('ADMIN_EMAIL') ?? 'info@inyathi.co.za').trim().toLowerCase();
    const userEmail = String(user.email || '').trim().toLowerCase();
    const isAdmin = me?.role === 'admin' || metadataRole === 'admin' || Boolean(configuredAdminEmail && userEmail === configuredAdminEmail);

    if (profileError && !isAdmin) return json({ error: `Unable to verify admin role (${profileError.message}).` }, 403);
    if (!isAdmin) return json({ error: 'Forbidden: admin account required.' }, 403);

    const { email, fullName, location } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(fullName || '').trim();
    const normalizedLocation = String(location || '').trim();
    if (!normalizedEmail || !normalizedName) return json({ error: 'Name and email are required' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) return json({ error: 'Enter a valid driver email address' }, 400);
    if (normalizedLocation !== 'Cape Town' && normalizedLocation !== 'Joburg') {
      return json({ error: 'Location must be Cape Town or Joburg' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: inviteRowError } = await adminClient.from('driver_invites').upsert({
      email: normalizedEmail,
      full_name: normalizedName,
      location: normalizedLocation,
      invited_by: me?.id ?? null,
      invited_at: new Date().toISOString(),
      used_at: null,
    }, { onConflict: 'email' });
    if (inviteRowError) return json({ error: inviteRowError.message || 'Unable to save driver invite.' }, 500);

    const siteUrl = getSiteUrl(req);
    const redirectTo = `${siteUrl}/driver-signup.html?email=${encodeURIComponent(normalizedEmail)}`;

    const { error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: { full_name: normalizedName, role: 'driver' },
      redirectTo,
    });
    if (authInviteError) return json({ error: authInviteError.message || 'Unable to send driver invite email.' }, 400);

    return json({ success: true, message: 'Driver invite sent.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invite failed';
    return json({ error: message }, 500);
  }
});
