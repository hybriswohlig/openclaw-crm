// apps/web/src/app/(public)/legal/agb/[firma]/route.ts
//
// Serves the canonical AGB for a firma on the portal's own domain so the
// customer can open and read them before accepting an offer (§ 305 Abs. 2 BGB).
//
// Single source of truth: firmen/<firma>/agb.md on crm-tools. This route is a
// thin, cached proxy of the public crm-tools endpoint GET /legal/agb/{firma}.
// Caching (revalidate) keeps the AGB available even if crm-tools is briefly
// down; on a cold-cache failure we serve a graceful fallback.

import type { NextRequest } from "next/server";

export const revalidate = 86400; // 24h

const ALLOWED = new Set(["kottke", "ceylan"]);
const BASE = process.env.CRM_TOOLS_API_URL ?? "https://crm-tools.kottke.info";

const FALLBACK_HTML = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allgemeine Geschäftsbedingungen</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.55">
<h1>AGB derzeit nicht abrufbar</h1>
<p>Die Allgemeinen Geschäftsbedingungen können momentan nicht geladen werden.
Bitte versuchen Sie es in Kürze erneut oder fordern Sie die AGB per E-Mail an.</p>
</body></html>`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firma: string }> }
) {
  const { firma } = await params;
  const slug = firma.toLowerCase();
  if (!ALLOWED.has(slug)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const res = await fetch(`${BASE}/legal/agb/${slug}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const htmlBody = await res.text();
    return new Response(htmlBody, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (err) {
    console.error(`[legal/agb] failed to load AGB for "${slug}":`, err);
    return new Response(FALLBACK_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
