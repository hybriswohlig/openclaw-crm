// apps/web/src/app/(public)/legal/datenschutz/[firma]/route.ts
//
// Serves the Datenschutzerklärung for a firma on the portal's own domain.
// Rendered locally from per-firma constants that mirror the stammdaten in
// packages/customer-portal-core/src/stamm.ts. The sections describe what the
// portal actually does: Vercel hosting, token status link, first-party visit
// tracking (use-visit-tracker.ts + /api/public/[token]/track), the analytics
// scripts in the root layout, the email capture and the WhatsApp contact.

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
<title>Datenschutzerklärung | ${esc(a.firma)}</title>
<style>
  body{margin:0;background:#f7f8fa;color:#0f1722;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;-webkit-text-size-adjust:100%}
  main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
  h1{font-size:1.5rem;margin:0 0 1.5rem}
  h2{font-size:1.05rem;margin:2rem 0 0.5rem}
  p{margin:0.5rem 0}
  a{color:#0f1722}
</style>
</head>
<body>
<!-- Entwurf: Dieser Text wurde technisch aus dem Verhalten des Portals abgeleitet und sollte vom Inhaber juristisch geprüft werden. -->
<main>
  <h1>Datenschutzerklärung</h1>
  <p>Stand: Juni 2026. Diese Erklärung gilt für das Kunden-Portal, das Sie über Ihren persönlichen Status-Link erreichen.</p>

  <h2>Verantwortlicher</h2>
  <p>${esc(a.firma)}<br>Inhaber: ${esc(a.inhaber)}<br>${esc(a.strasse)}<br>${esc(a.ort)}</p>
  ${kontakt}

  <h2>Hosting</h2>
  <p>Das Portal wird bei Vercel Inc. (USA) gehostet. Beim Aufruf verarbeitet der Hoster technisch notwendige Server-Logs, insbesondere IP-Adresse, Zeitpunkt des Zugriffs und die aufgerufene Seite. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in der sicheren und stabilen Bereitstellung des Portals.</p>

  <h2>Status-Link mit Zugangscode</h2>
  <p>Sie erreichen das Portal über einen persönlichen Link mit einem zufälligen Zugangscode (Token). Über diesen Link werden Ihnen die Daten zu Ihrem Umzugsauftrag angezeigt, zum Beispiel Angebot, Termin und Dokumente. Bitte geben Sie den Link nicht an Dritte weiter. Wir können den Link jederzeit deaktivieren.</p>

  <h2>Besuchsmessung des Portals</h2>
  <p>Wenn Sie das Portal öffnen, erfassen wir, ob und wann Ihr Status-Link geöffnet wurde, die aktive Lesezeit, den Kanal des Aufrufs (zum Beispiel WhatsApp, E-Mail oder SMS), Geräteinformationen sowie Ihre IP-Adresse. Dazu wird eine zufällige Sitzungskennung im Speicher Ihres Browsers abgelegt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in der reibungslosen Abwicklung Ihres Auftrags, insbesondere darin nachzuvollziehen, ob unsere Unterlagen und Angebote Sie erreicht haben.</p>

  <h2>Cookies und Webanalyse</h2>
  <p>Zur Verbesserung des Portals setzen wir Webanalyse-Dienste ein. Google Analytics (Google Ireland Limited) laden wir nur, wenn Sie über den Cookie-Banner eingewilligt haben (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Ihre Entscheidung speichern wir in Ihrem Browser; Sie können sie jederzeit mit Wirkung für die Zukunft ändern, indem Sie die Website-Daten dieses Portals in Ihrem Browser löschen, der Banner erscheint dann erneut. Daneben setzen wir Plausible (cookielose, aggregierte Reichweitenmessung) und Amplitude (Analyse der Portal-Nutzung) ein; Rechtsgrundlage ist insoweit Art. 6 Abs. 1 lit. f DSGVO. Bei Google Analytics und Amplitude kann eine Übermittlung in die USA stattfinden.</p>

  <h2>E-Mail-Adresse</h2>
  <p>Wenn Sie im Portal Ihre E-Mail-Adresse hinterlegen, verwenden wir diese ausschließlich, um Ihnen Unterlagen zu Ihrem Auftrag zuzusenden, zum Beispiel Auftragsbestätigung und Rechnung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>

  <h2>Kommunikation über WhatsApp</h2>
  <p>Sie können uns über WhatsApp kontaktieren. Dabei werden Daten, zum Beispiel Ihre Telefonnummer und Nachrichteninhalte, an WhatsApp Ireland Limited übertragen; eine Übermittlung an Meta Platforms Inc. in die USA ist möglich. Die Nutzung von WhatsApp ist freiwillig. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, im Übrigen Art. 6 Abs. 1 lit. f DSGVO.</p>

  <h2>Speicherdauer</h2>
  <p>Wir speichern personenbezogene Daten für die Dauer der Vertragsabwicklung und darüber hinaus, soweit gesetzliche Aufbewahrungsfristen bestehen, insbesondere nach Handels- und Steuerrecht. Danach werden die Daten gelöscht.</p>

  <h2>Ihre Rechte</h2>
  <p>Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO) und Datenübertragbarkeit (Art. 20 DSGVO) sowie das Recht, Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO zu widersprechen (Art. 21 DSGVO). Wenden Sie sich dazu bitte an die oben genannten Kontaktdaten.</p>

  <h2>Beschwerderecht</h2>
  <p>Sie haben das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren. Zuständig ist der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg, <a href="https://www.baden-wuerttemberg.datenschutz.de" target="_blank" rel="noopener noreferrer">www.baden-wuerttemberg.datenschutz.de</a>.</p>
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
