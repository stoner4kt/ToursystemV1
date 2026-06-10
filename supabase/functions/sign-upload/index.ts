import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLOUD_NAME    = Deno.env.get("CLOUDINARY_CLOUD_NAME")!;
const API_KEY       = Deno.env.get("CLOUDINARY_API_KEY")!;
const API_SECRET    = Deno.env.get("CLOUDINARY_API_SECRET")!;
const UPLOAD_PRESET = Deno.env.get("CLOUDINARY_UPLOAD_PRESET") || "inyathi_signed";

const ALLOWED_FOLDERS = new Set([
  "inyathi/booking-documents",
  "inyathi/booking-itinerary",
  "inyathi/inspections",
  "inyathi/driver-documents",
  "inyathi/vehicle-documents",
  "inyathi/recon-slips",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha1(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf  = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const respond = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "User not authorized to upload." }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return respond({ error: "User not authorized to upload." }, 401);

    const body = await req.json().catch(() => ({}));
    const { folder } = body as { folder?: string };

    if (!folder || !ALLOWED_FOLDERS.has(folder)) {
      return respond({ error: `Upload folder not allowed: ${folder ?? "(none)"}` }, 400);
    }

    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      console.error("[sign-upload] Missing Cloudinary env vars");
      return respond({ error: "Upload preset misconfigured." }, 500);
    }

    const timestamp = Math.round(Date.now() / 1000);

    // Parameters signed — sorted alphabetically.
    // type=upload forces public delivery, overriding any 'authenticated' preset setting.
    // This means secure_url values are directly accessible without signed delivery URLs.
    const paramsStr = `folder=${folder}&timestamp=${timestamp}&type=upload&upload_preset=${UPLOAD_PRESET}`;
    const signature = await sha1(`${paramsStr}${API_SECRET}`);

    console.log(
      `[sign-upload] user=${user.id} folder=${folder} preset=${UPLOAD_PRESET} type=upload ts=${timestamp}`,
    );

    return respond({
      signature,
      timestamp,
      api_key: API_KEY,
      cloud_name: CLOUD_NAME,
      upload_preset: UPLOAD_PRESET,
      folder,
      type: "upload",
    });
  } catch (err) {
    console.error("[sign-upload] unexpected error:", err);
    return respond({ error: "Could not generate upload signature." }, 500);
  }
});
