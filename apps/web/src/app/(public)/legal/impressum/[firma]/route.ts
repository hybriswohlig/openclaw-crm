// apps/web/src/app/(public)/legal/impressum/[firma]/route.ts
//
// Serves the Impressum for a firma on the portal's own domain (§ 5 DDG,
// § 18 Abs. 2 MStV). Unlike the AGB route there is no upstream fetch: the
// content is rendered locally from per-firma constants that mirror the
// stammdaten in packages/customer-portal-core/src/stamm.ts.

import type { NextRequest } from "next/server";

export const revalidate = 86400; // 24h

type Anbieter = {
  firma: string;
  inhaber: string;
  strasse: string;
  ort: string;
  telefon: string | null;
  email: string | null;
};

const ANBIETER: Record<string, Anbieter> = {
  kottke: {
    firma: "Kottke Dienstleistungen",
    inhaber: "Darioush Kottke",
    strasse: "Marktstr. 8",
    ort: "72218 Wildberg",
    telefon: "+49 175 9498475",
    email: null,
  },
  ceylan: {
    firma: "Ceylan Umzüge & Transporte",
    inhaber: "Nurullah Ceylan",
    strasse: "Kapellenberg 13",
    ort: "72218 Wildberg",
    telefon: null,
    email: "info@ceylan-operations.de",
  },
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(a: Anbieter): string {
  const kontakt = [
    a.telefon
      ? `<p>Telefon: <a href="tel:${a.telefon.replace(/\s/g, "")}">${esc(a.telefon)}</a></p>`
      : "",
    a.email
      ? `<p>E-Mail: <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Impressum | ${esc(a.firma)}</title>
<style>
  body{margin:0;background:#f7f8fa;color:#0f1722;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;-webkit-text-size-adjust:100%}
  main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
  h1{font-size:1.5rem;margin:0 0 1.5rem}
  h2{font-size:1.05rem;margin:2rem 0 0.5rem}
  p{margin:0.25rem 0}
  a{color:#0f1722}
</style>
</head>
<body>
<main>
  <h1>Impressum</h1>

  <h2>Angaben gemäß § 5 DDG</h2>
  <p>${esc(a.firma)}</p>
  <p>Inhaber: ${esc(a.inhaber)}</p>
  <p>${esc(a.strasse)}</p>
  <p>${esc(a.ort)}</p>

  <h2>Kontakt</h2>
  ${kontakt}

  <h2>Verantwortlich im Sinne des § 18 Abs. 2 MStV</h2>
  <p>${esc(a.inhaber)}, ${esc(a.strasse)}, ${esc(a.ort)}</p>
</main>
</body>
</html>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firma: string }> }
) {
  const { firma } = await params;
  const anbieter = ANBIETER[firma.toLowerCase()];
  if (!anbieter) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(renderHtml(anbieter), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
