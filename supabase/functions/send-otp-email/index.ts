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

function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { resource_type, resource_id, admin_id, context_label } = await req.json();

    if (!resource_type || !resource_id) {
      return new Response(JSON.stringify({ error: 'resource_type and resource_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Rate-limit: max 3 OTP requests per 10 minutes per resource
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from('otp_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('resource_id', resource_id)
      .eq('resource_type', resource_type)
      .gte('created_at', tenMinsAgo);

    if ((count ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ error: 'Rate limit: max 3 OTP requests per 10 minutes. Try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const otp = generateOTP();
    const otpHash = await sha256Hex(otp);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: insertError } = await supabaseAdmin
      .from('otp_verifications')
      .insert({
        admin_id: admin_id ?? null,
        resource_type,
        resource_id,
        otp_hash: otpHash,
        expires_at: expiresAt,
      });

    if (insertError) throw new Error(`DB insert failed: ${insertError.message}`);

    const adminEmail = Deno.env.get('ADMIN_EMAIL') ?? 'info@inyathi.co.za';
    const resendKey  = Deno.env.get('RESEND_API_KEY') ?? '';

    if (!resendKey) {
      console.warn('RESEND_API_KEY not set — OTP generated but email not sent. OTP:', otp);
      return new Response(
        JSON.stringify({ success: true, warning: 'Email not configured; OTP logged server-side only.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const label = context_label ?? resource_type.replace(/_/g, ' ');
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `INYATHI Fleet <noreply@inyathi.co.za>`,
        to: [adminEmail],
        subject: `🔐 INYATHI OTP Code — ${label}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#0f2744;margin-bottom:4px">INYATHI Fleet Management</h2>
            <p style="color:#64748b;margin-top:0">One-Time Password</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="font-size:14px;color:#1e293b">A <strong>${label}</strong> action requires your approval. Use the code below to verify:</p>
            <div style="background:#f0f4f8;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
              <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#0f2744">${otp}</span>
            </div>
            <p style="font-size:13px;color:#64748b">⏱ This code expires in <strong>15 minutes</strong>.<br>🔒 If you did not request this, contact your system administrator immediately.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="font-size:11px;color:#94a3b8">INYATHI (Pty) Ltd · Fleet Management System</p>
          </div>`,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      throw new Error(`Resend API error: ${errBody}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('send-otp-email error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
