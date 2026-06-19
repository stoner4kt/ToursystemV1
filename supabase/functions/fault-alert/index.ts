import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { vehicle_reg, driver_id, faults, inspection_id } = await req.json();

    if (!vehicle_reg || !Array.isArray(faults) || faults.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendKey  = Deno.env.get('RESEND_API_KEY') ?? '';
    const adminEmail = Deno.env.get('ADMIN_EMAIL') ?? 'info@inyathitours.com';

    if (!resendKey) {
      console.warn('RESEND_API_KEY not set — fault alert email not sent.');
      return new Response(
        JSON.stringify({ success: false, error: 'Email not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const timestamp = new Date().toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const faultRows = faults
      .map((f: string, i: number) => `
        <tr${i % 2 === 1 ? ' style="background:#f8fafc"' : ''}>
          <td style="padding:8px 0;color:#64748b;width:40px">${i + 1}.</td>
          <td style="padding:8px 0;color:#1e293b">${f}</td>
        </tr>`)
      .join('');

    const subject = `🚨 INYATHI Critical Fault Alert — ${vehicle_reg}`;

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#0f2744;margin-bottom:4px">INYATHI Fleet Management</h2>
        <p style="color:#ef4444;font-weight:700;margin-top:0">🚨 Critical Fault Alert</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#64748b;width:160px">Vehicle</td><td style="padding:8px 0;font-weight:700;color:#0f2744">${vehicle_reg}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Driver ID</td><td style="padding:8px 0;color:#1e293b">${driver_id ?? 'N/A'}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Time</td><td style="padding:8px 0;color:#1e293b">${timestamp}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Inspection ID</td><td style="padding:8px 0;color:#1e293b">${inspection_id ?? 'N/A'}</td></tr>
        </table>
        <p style="font-size:14px;font-weight:700;color:#0f2744;margin:20px 0 8px">Faults reported:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${faultRows}
        </table>
        <div style="background:#fff7ed;border-left:4px solid #f97316;padding:14px 16px;border-radius:8px;margin:20px 0">
          <strong style="color:#c2410c">Action Required:</strong>
          <p style="margin:6px 0 0;color:#9a3412;font-size:14px">Vehicle must be inspected before the next trip.</p>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="font-size:11px;color:#94a3b8">INYATHI (Pty) Ltd · Fleet Management System · Automated alert</p>
      </div>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'INYATHI Fleet <noreply@inyathitours.com>',
        to: [adminEmail],
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Email send failed: ${errText}`);
    }

    if (inspection_id) {
      const adminClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      await adminClient.from('inspections').update({ alert_sent: true }).eq('id', inspection_id);
    }

    return new Response(JSON.stringify({ success: true, sentTo: adminEmail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('fault-alert error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
