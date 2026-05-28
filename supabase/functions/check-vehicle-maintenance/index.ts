import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const resendKey  = Deno.env.get('RESEND_API_KEY') ?? '';
    const adminEmail = Deno.env.get('ADMIN_EMAIL') ?? 'info@inyathi.co.za';

    // Target: bookings ending in exactly 2 days, alert not yet sent, not cancelled
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 2);
    const targetStr = targetDate.toISOString().split('T')[0];

    // Allow manual trigger for a specific booking_id
    let bookingIdFilter: string | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        bookingIdFilter = body?.booking_id ?? null;
      } catch (_) {}
    }

    let query = supabaseAdmin
      .from('bookings')
      .select('id, invoice_no, client_name, assigned_driver_id, assigned_vehicle_reg, start_date, end_date, tour_reference')
      .neq('status', 'cancelled')
      .eq('maintenance_alert_sent', false);

    if (bookingIdFilter) {
      query = query.eq('id', bookingIdFilter);
    } else {
      query = query.eq('end_date', targetStr);
    }

    const { data: bookings, error } = await query;
    if (error) throw new Error(error.message);
    if (!bookings?.length) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No bookings require alerts.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const booking of bookings) {
      try {
        const daysUntil = bookingIdFilter
          ? Math.ceil((new Date(booking.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : 2;

        const subject = `🚌 Vehicle Maintenance Alert: ${booking.assigned_vehicle_reg ?? 'Unknown'} returning in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;

        const html = `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#0f2744;margin-bottom:4px">INYATHI Fleet Management</h2>
            <p style="color:#f59e0b;font-weight:700;margin-top:0">⚠ Vehicle Maintenance Alert</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:8px 0;color:#64748b;width:160px">Vehicle</td><td style="padding:8px 0;font-weight:700;color:#0f2744">${booking.assigned_vehicle_reg ?? '—'}</td></tr>
              <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Invoice</td><td style="padding:8px 0;color:#1e293b">${booking.invoice_no}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">Client</td><td style="padding:8px 0;color:#1e293b">${booking.client_name}</td></tr>
              <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Driver ID</td><td style="padding:8px 0;color:#1e293b">${booking.assigned_driver_id ?? '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">Tour / Route</td><td style="padding:8px 0;color:#1e293b">${booking.tour_reference ?? '—'}</td></tr>
              <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Start Date</td><td style="padding:8px 0;color:#1e293b">${booking.start_date}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-weight:700">Return Date</td><td style="padding:8px 0;color:#ef4444;font-weight:700">${booking.end_date}</td></tr>
            </table>
            <div style="background:#fff7ed;border-left:4px solid #f97316;padding:14px 16px;border-radius:8px;margin:20px 0">
              <strong style="color:#c2410c">Action Required:</strong>
              <p style="margin:6px 0 0;color:#9a3412;font-size:14px">Please arrange collection, inspection, and return of the vehicle to the depot by the end of the return date.</p>
            </div>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="font-size:11px;color:#94a3b8">INYATHI (Pty) Ltd · Fleet Management System · Automated alert</p>
          </div>`;

        if (resendKey) {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'INYATHI Fleet <noreply@inyathi.co.za>', to: [adminEmail], subject, html }),
          });
          if (!emailRes.ok) {
            const errText = await emailRes.text();
            throw new Error(`Email send failed: ${errText}`);
          }
        } else {
          console.warn(`RESEND_API_KEY not set — alert not emailed for booking ${booking.id}`);
        }

        await supabaseAdmin
          .from('bookings')
          .update({ maintenance_alert_sent: true, maintenance_alert_sent_at: new Date().toISOString() })
          .eq('id', booking.id);

        results.push({ id: booking.id, ok: true });
      } catch (bookingErr) {
        const msg = bookingErr instanceof Error ? bookingErr.message : String(bookingErr);
        console.error(`Alert failed for booking ${booking.id}:`, msg);
        results.push({ id: booking.id, ok: false, error: msg });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    return new Response(
      JSON.stringify({ success: true, processed: bookings.length, succeeded: successCount, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('check-vehicle-maintenance error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
