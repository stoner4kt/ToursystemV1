import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCurrency(amount: unknown): string {
  if (amount === null || amount === undefined || amount === '') return 'Not specified';
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? `R ${numeric.toFixed(2)}` : escapeHtml(amount);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ error: 'Missing bearer token' }, 401);

    const { traffic_fine_id } = await req.json();
    if (!traffic_fine_id) return jsonResponse({ error: 'traffic_fine_id required' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userResult.user) return jsonResponse({ error: 'Invalid bearer token' }, 401);

    const { data: requester, error: requesterError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', userResult.user.id)
      .single();

    if (requesterError || requester?.role !== 'admin') {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const { data: fine, error: fineError } = await supabaseAdmin
      .from('traffic_fines')
      .select(`
        id,
        booking_id,
        vehicle_reg,
        driver_id,
        fine_timestamp,
        fine_reference,
        location,
        description,
        amount,
        notification_email,
        bookings!traffic_fines_booking_id_fkey(invoice_no, client_name, route),
        profiles!traffic_fines_driver_id_fkey(name, phone, email)
      `)
      .eq('id', traffic_fine_id)
      .single();

    if (fineError || !fine) return jsonResponse({ error: 'Traffic fine not found' }, 404);

    const driverEmail = fine.profiles?.email?.trim();
    const extraEmail = fine.notification_email?.trim();
    const recipients = Array.from(new Set([driverEmail, extraEmail].filter(Boolean)));

    if (!recipients.length) {
      await supabaseAdmin
        .from('traffic_fines')
        .update({ notification_error: 'No profile or notification email available' })
        .eq('id', traffic_fine_id);
      return jsonResponse({ error: 'At least one recipient email is required' }, 400);
    }

    if (!resendKey) {
      await supabaseAdmin
        .from('traffic_fines')
        .update({ notification_error: 'RESEND_API_KEY is not configured' })
        .eq('id', traffic_fine_id);
      return jsonResponse({ success: true, warning: 'Email provider is not configured.' });
    }

    const driverName = fine.profiles?.name ?? fine.driver_id;
    const booking = fine.bookings ?? {};
    const subject = `Traffic fine notice — ${fine.vehicle_reg} (${booking.invoice_no ?? fine.booking_id})`;
    const html = `
      <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:32px 24px;color:#1e293b">
        <h2 style="color:#0f2744;margin:0 0 6px">INYATHI Fleet Management</h2>
        <p style="color:#dc2626;font-weight:700;margin:0 0 18px">Traffic fine logged against your assigned booking</p>
        <p>Dear ${escapeHtml(driverName)},</p>
        <p>An administrator has logged a traffic fine for a vehicle and time that matched your booking record.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:18px 0">
          <tr><td style="padding:9px;color:#64748b;width:170px">Booking</td><td style="padding:9px;font-weight:700">${escapeHtml(booking.invoice_no ?? fine.booking_id)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:9px;color:#64748b">Client / Route</td><td style="padding:9px">${escapeHtml(booking.client_name ?? '—')} / ${escapeHtml(booking.route ?? '—')}</td></tr>
          <tr><td style="padding:9px;color:#64748b">Vehicle</td><td style="padding:9px;font-weight:700">${escapeHtml(fine.vehicle_reg)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:9px;color:#64748b">Fine time</td><td style="padding:9px">${escapeHtml(new Date(fine.fine_timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }))}</td></tr>
          <tr><td style="padding:9px;color:#64748b">Reference</td><td style="padding:9px">${escapeHtml(fine.fine_reference ?? 'Not supplied')}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:9px;color:#64748b">Location</td><td style="padding:9px">${escapeHtml(fine.location ?? 'Not supplied')}</td></tr>
          <tr><td style="padding:9px;color:#64748b">Amount</td><td style="padding:9px;font-weight:700">${formatCurrency(fine.amount)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:9px;color:#64748b">Description</td><td style="padding:9px">${escapeHtml(fine.description ?? '—')}</td></tr>
        </table>
        <div style="background:#fff7ed;border-left:4px solid #f97316;padding:14px 16px;border-radius:8px;margin:20px 0">
          <strong style="color:#c2410c">Please review:</strong>
          <p style="margin:6px 0 0;color:#9a3412;font-size:14px">If you believe this attribution is incorrect, contact your administrator with the booking reference above.</p>
        </div>
        <p style="font-size:11px;color:#94a3b8">INYATHI (Pty) Ltd · Automated fine notification</p>
      </div>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('FINE_EMAIL_FROM') ?? 'INYATHI Fleet <noreply@inyathi.co.za>',
        to: recipients,
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errorText = await emailRes.text();
      await supabaseAdmin
        .from('traffic_fines')
        .update({ notification_error: `Resend error: ${errorText}` })
        .eq('id', traffic_fine_id);
      throw new Error(`Resend error: ${errorText}`);
    }

    await supabaseAdmin
      .from('traffic_fines')
      .update({ email_sent: true, email_sent_at: new Date().toISOString(), notification_error: null })
      .eq('id', traffic_fine_id);

    return jsonResponse({ success: true, recipients });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('notify-driver-fine error:', message);
    return jsonResponse({ error: message }, 500);
  }
});
