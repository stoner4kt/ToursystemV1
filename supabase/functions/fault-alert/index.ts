import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Recipient = { phone: string; apikey: string };

function getRecipients(): Recipient[] {
  const recipientsRaw = Deno.env.get('CALLMEBOT_RECIPIENTS') ?? '';

  if (recipientsRaw.trim()) {
    try {
      const parsed = JSON.parse(recipientsRaw);
      if (!Array.isArray(parsed)) {
        console.warn('CALLMEBOT_RECIPIENTS is not an array.');
      } else {
        return parsed
          .filter((r) => r && typeof r.phone !== 'undefined' && typeof r.apikey !== 'undefined')
          .map((r) => ({ phone: String(r.phone), apikey: String(r.apikey) }))
          .filter((r) => r.phone.trim() && r.apikey.trim());
      }
    } catch (error) {
      console.warn('Invalid CALLMEBOT_RECIPIENTS JSON:', error);
    }
  }

  const phone = Deno.env.get('CALLMEBOT_PHONE') ?? '';
  const apikey = Deno.env.get('CALLMEBOT_APIKEY') ?? '';
  if (phone.trim() && apikey.trim()) {
    return [{ phone, apikey }];
  }

  return [];
}

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

    const faultList = faults
      .slice(0, 5)
      .map((f: string, i: number) => `${i + 1}. ${f}`)
      .join('\n');

    const timestamp = new Date().toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const rawMessage =
      `🚨 *CRITICAL FAULT ALERT — CCSHUTTLES*\n\n` +
      `*Vehicle:* ${vehicle_reg}\n` +
      `*Driver ID:* ${driver_id ?? 'N/A'}\n` +
      `*Time:* ${timestamp}\n\n` +
      `*Faults reported:*\n${faultList}\n\n` +
      `*Inspection ID:* ${inspection_id ?? 'N/A'}\n\n` +
      `_Action required: Vehicle must be inspected before next trip._`;

    const message = encodeURIComponent(rawMessage);
    const recipients = getRecipients();

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'CallMeBot recipients are not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results: Array<{ phone: string; ok: boolean; status: number; response: string }> = [];

    for (const recipient of recipients) {
      const url =
        `https://api.callmebot.com/whatsapp.php?phone=${recipient.phone}` +
        `&text=${message}&apikey=${recipient.apikey}`;
      const alertRes = await fetch(url, { method: 'GET' });
      const alertText = await alertRes.text();
      results.push({
        phone: recipient.phone,
        ok: alertRes.ok,
        status: alertRes.status,
        response: alertText,
      });
    }

    const anySuccess = results.some((r) => r.ok);

    if (anySuccess && inspection_id) {
      const adminClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      await adminClient.from('inspections').update({ alert_sent: true }).eq('id', inspection_id);
    }

    return new Response(JSON.stringify({ success: anySuccess, recipients: results }), {
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
