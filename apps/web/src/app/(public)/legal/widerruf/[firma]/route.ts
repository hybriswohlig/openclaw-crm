// apps/web/src/app/(public)/legal/widerruf/[firma]/route.ts
//
// Widerrufsbelehrung und Muster-Widerrufsformular einer Firma auf der
// Portal-Domain. Gilt für Leistungen mit Widerrufsrecht (Küchenmontage);
// der Annahme-Dialog und die Bestätigungs-Mail verlinken hierher. Die Texte
// kommen aus packages/customer-portal-core/src/rechtstexte.ts.
import type { NextRequest } from "next/server";
import {
  firmaKontakt,
  musterWiderrufsformular,
  widerrufsbelehrung,
} from "@openclaw-crm/customer-portal-core";

export const revalidate = 86400; // 24h

const ALLOWED = new Set(["kottke", "ceylan"]);

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const UEBERSCHRIFTEN = new Set(["Widerrufsrecht", "Folgen des Widerrufs"]);

function renderHtml(slug: string): string {
  const kontakt = firmaKontakt(slug);
  const belehrung = widerrufsbelehrung(kontakt);
  const formular = musterWiderrufsformular(kontakt);
  const absaetze = belehrung.absaetze
    .map((a) => (UEBERSCHRIFTEN.has(a) ? `<h2>${esc(a)}</h2>` : `<p>${esc(a)}</p>`))
    .join("\n  ");
  const [formTitel, ...formZeilen] = formular;
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Widerrufsbelehrung | ${esc(kontakt.firma)}</title>
<style>
  body{margin:0;background:#f7f8fa;color:#0f1722;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;-webkit-text-size-adjust:100%}
  main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
  h1{font-size:1.5rem;margin:0 0 1.5rem}
  h2{font-size:1.05rem;margin:2rem 0 0.5rem}
  p{margin:0.5rem 0}
  section{margin-top:2.5rem;padding:1.25rem;border:1px solid #d7dce3;border-radius:0.75rem;background:#fff}
</style>
</head>
<body>
<main>
  <h1>${esc(belehrung.titel)}</h1>
  ${absaetze}
  <section>
  <h2>${esc(formTitel)}</h2>
  ${formZeilen.map((z) => `<p>${esc(z)}</p>`).join("\n  ")}
  </section>
</main>
</body>
</html>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firma: string }> }
) {
  const { firma } = await params;
  const slug = firma.toLowerCase();
  if (!ALLOWED.has(slug)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(renderHtml(slug), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
