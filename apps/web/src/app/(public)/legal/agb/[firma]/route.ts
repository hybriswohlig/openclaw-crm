// apps/web/src/app/(public)/legal/agb/[firma]/route.ts
//
// Serves the canonical AGB for a firma on the portal's own domain so the
// customer can open and read them before accepting an offer (§ 305 Abs. 2 BGB).
//
// Single source of truth: firmen/<firma>/agb.md on crm-tools. This route is a
// thin, cached proxy of the public crm-tools endpoint GET /legal/agb/{firma}.
// It loads through ladeAgbHtml, the same function and cache lifetime the KV
// acceptance uses for its AGB snapshot, so the stored text matches this page.
// On a cold-cache failure we serve a fallback with 503.

import type { NextRequest } from "next/server";
import { ladeAgbHtml } from "@/services/agb";

export const revalidate = 300; // wie AGB_CACHE_SEKUNDEN in services/agb.ts

const ALLOWED = new Set(["kottke", "ceylan"]);

const FALLBACK_HTML = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allgemeine Geschäftsbedingungen</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.55">
<h1>AGB derzeit nicht abrufbar</h1>
<p>Die AGB können gerade nicht geladen werden. Eine Annahme ist in dieser Zeit nicht möglich.
Bitte versuchen Sie es in ein paar Minuten erneut.</p>
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

  const htmlBody = await ladeAgbHtml(slug);
  if (htmlBody) {
    return new Response(htmlBody, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    });
  }
  console.error(`[legal/agb] failed to load AGB for "${slug}"`);
  return new Response(FALLBACK_HTML, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
