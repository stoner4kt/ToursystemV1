import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { expense_id } = await req.json();
    if (!expense_id) {
      return new Response(JSON.stringify({ error: 'expense_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: expense, error: fetchErr } = await supabaseAdmin
      .from('vehicle_expenses')
      .select('*, profiles!vehicle_expenses_driver_id_fkey(name, driver_id)')
      .eq('id', expense_id)
      .single();

    if (fetchErr || !expense) {
      return new Response(JSON.stringify({ error: 'Expense not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendKey  = Deno.env.get('RESEND_API_KEY') ?? '';
    const adminEmail = Deno.env.get('ADMIN_EMAIL') ?? 'info@inyathitours.com';

    if (!resendKey) {
      console.warn('RESEND_API_KEY not set — expense alert not emailed.');
      return new Response(JSON.stringify({ success: true, warning: 'Email not configured.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const driverName = expense.profiles?.name ?? expense.driver_id ?? 'Unknown Driver';
    const subject = `🔧 New Expense/Damage Submission — ${expense.vehicle_reg} (${expense.expense_type})`;

    const docsCount  = Array.isArray(expense.document_urls) ? expense.document_urls.length : 0;
    const photoCount = Array.isArray(expense.photo_urls)    ? expense.photo_urls.length    : 0;

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#0f2744;margin-bottom:4px">INYATHI Fleet Management</h2>
        <p style="color:#f59e0b;font-weight:700;margin-top:0">🔧 New Expense / Damage Claim Requires Approval</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#64748b;width:160px">Vehicle</td><td style="padding:8px 0;font-weight:700;color:#0f2744">${expense.vehicle_reg}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Type</td><td style="padding:8px 0;color:#1e293b">${expense.expense_type}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Amount</td><td style="padding:8px 0;font-weight:700;color:#0f2744">R ${Number(expense.amount).toFixed(2)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Date</td><td style="padding:8px 0;color:#1e293b">${expense.expense_date}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Submitted by</td><td style="padding:8px 0;color:#1e293b">${driverName}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 0;color:#64748b">Description</td><td style="padding:8px 0;color:#1e293b">${expense.description ?? '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Attachments</td><td style="padding:8px 0;color:#1e293b">${docsCount} document(s), ${photoCount} photo(s)</td></tr>
        </table>
        <div style="background:#fff7ed;border-left:4px solid #f97316;padding:14px 16px;border-radius:8px;margin:20px 0">
          <strong style="color:#c2410c">Action Required:</strong>
          <p style="margin:6px 0 0;color:#9a3412;font-size:14px">Log in to the INYATHI admin dashboard → Damages &amp; Expenses tab to review and approve or reject this submission.</p>
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
      throw new Error(`Resend error: ${errText}`);
    }

    // Mark alert as sent
    await supabaseAdmin
      .from('vehicle_expenses')
      .update({ alert_sent: true })
      .eq('id', expense_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('notify-expense-submitted error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
