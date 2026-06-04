import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UPLOAD_PRESET = 'inyathi_signed';
const VALID_RESOURCE_TYPES = new Set(['image', 'video', 'raw', 'auto']);

// Cloudinary Dashboard migration notes:
// - Create upload preset "inyathi_signed" with Signing mode SIGNED (not unsigned).
// - Set Delivery type to authenticated and Folder to inyathi.
// - Allowed formats: jpg,jpeg,png,webp,gif,mp4,mov,webm,pdf,doc,docx.
// - Disable the old unsigned preset "transroute_uploads" after migration.

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function buildSignatureParams(params: Record<string, string | number>) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

async function sha1Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401);

    const supabase = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
    const resourceType = typeof body.resource_type === 'string' ? body.resource_type : 'auto';
    if (!folder) return json({ error: 'folder is required' }, 400);
    if (!VALID_RESOURCE_TYPES.has(resourceType)) return json({ error: 'Invalid resource_type' }, 400);

    const cloudName = requireEnv('CLOUDINARY_CLOUD_NAME');
    const apiKey = requireEnv('CLOUDINARY_API_KEY');
    const apiSecret = requireEnv('CLOUDINARY_API_SECRET');
    const timestamp = Math.round(Date.now() / 1000);
    const params = { timestamp, folder, upload_preset: UPLOAD_PRESET };
    const signature = await sha1Hex(`${buildSignatureParams(params)}${apiSecret}`);

    return json({
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder,
      upload_preset: UPLOAD_PRESET,
    });
  } catch (err) {
    console.error('[sign-upload]', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
