import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { resource_type, resource_id, otp_code } = await req.json();

    if (!resource_type || !resource_id || !otp_code) {
      return new Response(
        JSON.stringify({ error: 'resource_type, resource_id and otp_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!/^\d{6}$/.test(otp_code)) {
      return new Response(
        JSON.stringify({ error: 'OTP must be exactly 6 digits' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Fetch the latest unverified, unexpired OTP for this resource
    const now = new Date().toISOString();
    const { data: otpRows, error: fetchError } = await supabaseAdmin
      .from('otp_verifications')
      .select('id, otp_hash, expires_at, attempts, verified_at')
      .eq('resource_type', resource_type)
      .eq('resource_id', resource_id)
      .is('verified_at', null)
      .gte('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) throw new Error(fetchError.message);
    if (!otpRows?.length) {
      return new Response(
        JSON.stringify({ verified: false, error: 'No valid OTP found. It may have expired — request a new one.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const record = otpRows[0];

    // Enforce max 3 attempts
    if (record.attempts >= 3) {
      return new Response(
        JSON.stringify({ verified: false, error: 'Too many failed attempts. Request a new OTP.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const submittedHash = await sha256Hex(otp_code.trim());
    const matched = submittedHash === record.otp_hash;

    if (!matched) {
      // Increment attempts
      await supabaseAdmin
        .from('otp_verifications')
        .update({ attempts: record.attempts + 1 })
        .eq('id', record.id);

      const remaining = 3 - (record.attempts + 1);
      return new Response(
        JSON.stringify({
          verified: false,
          error: `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
          attempts_remaining: remaining,
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Mark as verified
    await supabaseAdmin
      .from('otp_verifications')
      .update({ verified_at: now })
      .eq('id', record.id);

    return new Response(
      JSON.stringify({ verified: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('verify-otp error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
