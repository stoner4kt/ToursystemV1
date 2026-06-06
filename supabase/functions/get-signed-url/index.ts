import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import cloudinary from 'npm:cloudinary';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_RESOURCE_TYPES = new Set(['image', 'video', 'raw']);

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
    const publicId = typeof body.publicId === 'string' ? body.publicId.trim() : '';
    const resourceType = typeof body.resourceType === 'string' ? body.resourceType : 'image';
    const asAttachment = Boolean(body.asAttachment);
    if (!publicId) return json({ error: 'publicId is required' }, 400);
    if (!VALID_RESOURCE_TYPES.has(resourceType)) return json({ error: 'Invalid resourceType' }, 400);

    const cloudinaryClient = cloudinary.v2 ?? cloudinary;
    cloudinaryClient.config({
      cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
      api_key: requireEnv('CLOUDINARY_API_KEY'),
      api_secret: requireEnv('CLOUDINARY_API_SECRET'),
    });

    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 600;
    const signedUrl = cloudinaryClient.url(publicId, {
      sign_url: true,
      type: 'authenticated',
      expires_at: expiresAtSeconds,
      resource_type: resourceType || 'image',
      attachment: asAttachment || false,
    });

    return json({ signedUrl, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() });
  } catch (err) {
    console.error('[get-signed-url]', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
