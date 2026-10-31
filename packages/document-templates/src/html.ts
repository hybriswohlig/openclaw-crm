import { KOTTKE_LOGO_JPEG_BASE64 } from "./marke/logo-kottke-umzuege";
import type { DocumentModel, IssuerContact } from "./types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textBlock(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function addressLines(address: string | undefined): string[] {
  if (!address?.trim()) return [];
  const match = address.trim().match(/^(.*),\s*(\d{5}\s+.+)$/);
  if (match) return [match[1].trim(), match[2].trim()];
  return [address.trim()];
}

function companyLines(model: DocumentModel): string[] {
  const c: IssuerContact = model.issuer.contact;
  const place = [c.street, c.place].filter(Boolean).join(" · ");
  return [
    c.owner,
    place || undefined,
    c.phone ? `Tel.: ${c.phone}` : undefined,
    c.whatsapp ? `WhatsApp: ${c.whatsapp}` : undefined,
    c.email ? `E-Mail: ${c.email}` : undefined,
    c.website ? `Web: ${c.website}` : undefined,
    c.kleinunternehmer ? `<span class="co-note">Kleinunternehmer gem. § 19 UStG</span>` : undefined,
    c.taxNumber ? `Steuernummer ${c.taxNumber}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function footerLines(model: DocumentModel): string[] {
  const c = model.issuer.contact;
  const bank = model.issuer.bank;
  const head = [model.issuer.displayName, c.owner, c.street, c.place].filter(Boolean).join(" · ");
  const mid = [
    c.phone ? `Tel.: ${c.phone}` : null,
    c.whatsapp ? `WhatsApp: ${c.whatsapp}` : null,
    c.email ? `E-Mail: ${c.email}` : null,
    c.website ? `Web: ${c.website}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tail = [
    `Bankverbindung: ${bank.iban}`,
    `BIC: ${bank.bic}`,
    c.kleinunternehmer ? "Kleinunternehmer gem. § 19 UStG" : null,
    c.taxNumber ? `Steuernummer ${c.taxNumber}` : null,
    `Vorlage ${model.templateVersion}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return [head, mid, tail];
}

/** Self-contained HTML preview. Every dynamic string is escaped. */
export function renderHtml(model: DocumentModel): string {
  const accent = model.issuer.accent;
  const logo =
    model.issuer.slug === "kottke"
      ? `<img class="logo" alt="Kottke-Umzüge" src="data:image/jpeg;base64,${KOTTKE_LOGO_JPEG_BASE64}">`
      : `<p class="brand">${escapeHtml(model.issuer.displayName)}</p>`;
  const positions = model.positions
    .map(
      (p, index) =>
        `<tr><td class="pos">${index + 1}</td><td>${escapeHtml(p.leistung)}</td><td>${textBlock(p.beschreibung)}</td><td class="num">${escapeHtml(p.quantityLabel)}</td><td class="num">${escapeHtml(p.amountLabel)}</td></tr>`
    )
    .join("");
  const table = positions
    ? `<table class="lines">
    <thead><tr><th>Pos.</th><th>Leistung</th><th>Beschreibung</th><th class="num">Menge</th><th class="num">Betrag</th></tr></thead>
    <tbody>${positions}</tbody>
  </table>`
    : "";
  const scope = model.scopeLines.length
    ? `<ul>${model.scopeLines.map((line) => `<li>${textBlock(line)}</li>`).join("")}</ul>`
    : "";
  const info = model.infoRows
    .map(
      (row) =>
        `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`
    )
    .join("");
  const recipient = [
    model.recipientLines[0],
    ...addressLines(model.customerAddress ?? model.recipientLines[1]),
  ].filter((line): line is string => Boolean(line));
  const open = model.openLabel ?? model.totalLabel;
  const bankBits = model.showBank
    ? `<p><strong>Kontoinhaber:</strong> ${escapeHtml(model.issuer.bank.holder)}<br><strong>IBAN:</strong> ${escapeHtml(model.issuer.bank.iban)}<br><strong>BIC:</strong> ${escapeHtml(model.issuer.bank.bic)}</p>`
    : "";
  const purpose = model.invoiceNumber
    ? `<p><strong>Verwendungszweck:</strong> ${escapeHtml(model.invoiceNumber)}</p>`
    : "";
  const payBox = `<h2>Zahlungsinformationen</h2><section class="paybox">${
    model.paymentTerms ? `<p>${textBlock(model.paymentTerms)}</p>` : ""
  }${bankBits}${purpose}${
    model.kind === "RE" ? `<p><strong>Betrag (offen):</strong> ${escapeHtml(open)}</p>` : ""
  }${model.depositLabel ? `<p>Anzahlung: ${escapeHtml(model.depositLabel)}</p>` : ""}${
    model.paidLabel ? `<p>Bereits gebucht: ${escapeHtml(model.paidLabel)}</p>` : ""
  }${model.paymentNote ? `<p>${escapeHtml(model.paymentNote)}</p>` : ""}</section>`;
  const section35 = model.section35a
    ? `<section class="block35"><h2>Hinweis nach § 35a EStG</h2><p>Anteil der Arbeits- und Fahrtkosten: ${escapeHtml(model.section35a.amountLabel)}.${
        model.section35a.serviceAddress
          ? `<br>Leistungsort: ${textBlock(model.section35a.serviceAddress)}.`
          : ""
      }<br>${escapeHtml(model.section35a.note)}</p></section>`
    : "";
  const vatRow = model.issuer.contact.kleinunternehmer
    ? `<div class="sum"><span>Umsatzsteuer gem. § 19 UStG (Kleinunternehmer)</span><span>0,00 €</span></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="template-version" content="${escapeHtml(model.templateVersion)}">
<title>${escapeHtml(model.title)} · ${escapeHtml(model.customerName)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #eef1f4; color: #222; font: 15px/1.45 Helvetica, Arial, sans-serif; }
  main { max-width: 820px; margin: 24px auto; background: #fff; padding: 36px 42px 28px; overflow-wrap: anywhere; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { width: 210px; height: auto; display: block; }
  .brand { margin: 0; font-size: 18px; font-weight: 700; color: ${accent}; }
  .company { text-align: right; font-size: 12px; line-height: 1.35; color: #333; }
  .company .co-name { margin: 0 0 2px; font-size: 14px; font-weight: 700; color: #222; }
  .company p { margin: 0; }
  .rule { height: 2px; background: ${accent}; margin: 14px 0 18px; }
  .parties { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  .recipient { font-size: 14px; line-height: 1.4; }
  .recipient p { margin: 0; }
  table.info { border-collapse: collapse; font-size: 12px; min-width: 280px; }
  table.info th, table.info td { border: 1px solid #c8d3df; padding: 5px 8px; }
  table.info th { color: ${accent}; font-weight: 700; width: 46%; text-align: left; background: #f4f7fb; }
  table.info td { text-align: right; }
  h1.display { margin: 28px 0 0; text-align: center; color: ${accent}; font-size: 26px; letter-spacing: 0.04em; }
  .subtitle { text-align: center; color: #555; margin: 4px 0 16px; font-size: 13px; }
  .svc { position: absolute; width: 1px; height: 1px; overflow: hidden; }
  h2 { color: ${accent}; font-size: 15px; margin: 22px 0 4px; border-bottom: 1px solid ${accent}; padding-bottom: 2px; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  table.lines th { background: ${accent}; color: #fff; font-weight: 700; text-align: left; padding: 6px 8px; }
  table.lines td { padding: 6px 8px; border-bottom: 1px solid #e1e7ee; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .pos { width: 36px; }
  .sum { display: flex; justify-content: space-between; gap: 12px; padding: 6px 8px; font-size: 13px; }
  .sum.sub { margin-top: 2px; background: #f4f7fb; font-weight: 700; }
  .grand { display: flex; justify-content: space-between; gap: 12px; margin-top: 2px; background: ${accent}; color: #fff; font-weight: 700; padding: 8px 10px; }
  .tax { font-size: 12px; color: #444; margin: 8px 0 0; }
  .co-note { font-style: italic; }
  .paybox { background: #f4f7fb; border-left: 4px solid ${accent}; padding: 10px 14px 12px; }
  .paybox p { margin: 6px 0; }
  p, li { color: #222; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  .sign { margin-top: 18px; }
  .sign p { margin: 0; }
  footer { margin-top: 28px; text-align: center; color: #777; font-size: 10px; line-height: 1.45; }
  footer p { margin: 0; color: #777; }
  @media print { body { background: #fff; } main { margin: 0; } }
</style>
</head>
<body>
<main data-service="${escapeHtml(model.serviceKind)}" data-address="${escapeHtml(model.addressForm)}">
  <header>
    <div>${logo}</div>
    <div class="company">
      <p class="co-name">${escapeHtml(model.issuer.displayName)}</p>
      ${companyLines(model)
        .map((line) => (line.startsWith("<") ? `<p>${line}</p>` : `<p>${escapeHtml(line)}</p>`))
        .join("")}
    </div>
  </header>
  <div class="rule"></div>
  <div class="parties">
    <div class="recipient">${recipient.map((line) => `<p>${textBlock(line)}</p>`).join("")}</div>
    <table class="info">${info}</table>
  </div>
  <h1 class="display">${escapeHtml(model.displayTitle)}</h1>
  ${model.subtitle ? `<p class="subtitle">${escapeHtml(model.subtitle)}</p>` : ""}
  <span class="svc">${escapeHtml(model.serviceName)}</span>
  ${model.intro.map((p) => `<p>${textBlock(p)}</p>`).join("")}
  ${
    model.summary
      ? model.kind === "KV"
        ? `<h2>Leistungsumfang</h2><p>${textBlock(model.summary)}</p>`
        : `<p>${textBlock(model.summary)}</p>`
      : ""
  }
  ${scope}
  <h2>Leistungsübersicht</h2>
  ${table}
  ${model.discountLines
    .map(
      (line) =>
        `<div class="sum"><span>${escapeHtml(line.label)}</span><span>${escapeHtml(line.amountLabel)}</span></div>`
    )
    .join("")}
  <div class="sum sub"><span>Zwischensumme</span><span>${escapeHtml(model.totalLabel)}</span></div>
  ${vatRow}
  <div class="grand"><span>${escapeHtml(model.totalBarLabel)}</span><span>${escapeHtml(model.totalLabel)}</span></div>
  <p class="tax">${escapeHtml(model.taxNote)}</p>
  ${payBox}
  ${section35}
  ${
    model.hintLines.length
      ? `<h2>Hinweise</h2>${model.hintLines.map((line) => `<p>${textBlock(line)}</p>`).join("")}`
      : ""
  }
  ${model.closing.map((p) => `<p>${textBlock(p)}</p>`).join("")}
  <div class="sign"><p>Mit freundlichen Grüßen</p><p><strong>${escapeHtml(model.signatory ?? "")}</strong></p><p>${escapeHtml(model.issuer.displayName)}</p></div>
  <footer>${footerLines(model).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</footer>
</main>
</body>
</html>`;
}
