import type { DocumentModel } from "./types";

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

function row(label: string, value: string | undefined): string {
  if (!value) return "";
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${textBlock(value)}</strong></div>`;
}

/** Self-contained HTML preview. Every dynamic string is escaped. */
export function renderHtml(model: DocumentModel): string {
  const positions = model.positions
    .map(
      (p) =>
        `<tr><td>${textBlock(p.title)}</td><td class="num">${escapeHtml(p.quantityLabel)}</td><td class="num">${escapeHtml(p.unitRateLabel)}</td><td class="num">${escapeHtml(p.amountLabel)}</td></tr>`
    )
    .join("");
  const scope = model.scopeLines.length
    ? `<ul>${model.scopeLines.map((line) => `<li>${textBlock(line)}</li>`).join("")}</ul>`
    : "";
  const bank = model.showBank
    ? `<section><h2>Bankverbindung</h2><p>${escapeHtml(model.issuer.bank.holder)}<br>IBAN ${escapeHtml(model.issuer.bank.iban)}<br>BIC ${escapeHtml(model.issuer.bank.bic)}</p></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="template-version" content="${escapeHtml(model.templateVersion)}">
<title>${escapeHtml(model.title)} · ${escapeHtml(model.customerName)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f1ea; color: #1c1917; font: 15px/1.45 "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 820px; margin: 24px auto; background: #fff; padding: 40px 48px 32px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid ${model.issuer.accent}; padding-bottom: 16px; }
  .brand { font-size: 20px; font-weight: 700; color: ${model.issuer.accent}; margin: 0 0 6px; }
  .muted { color: #57534e; font-size: 13px; }
  h1 { margin: 22px 0 4px; font-size: 26px; }
  h2 { font-size: 14px; margin: 22px 0 6px; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-top: 16px; }
  .fact { display: flex; flex-direction: column; font-size: 14px; }
  .fact span { color: #78716c; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
  th { font-size: 12px; color: #57534e; font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
  .total { display: flex; justify-content: space-between; margin-top: 12px; font-size: 18px; font-weight: 700; }
  .meta { margin-top: 8px; }
  p { margin: 8px 0; white-space: normal; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  footer { margin-top: 28px; border-top: 1px solid #e7e5e4; padding-top: 10px; color: #78716c; font-size: 12px; }
  @media print { body { background: #fff; } main { box-shadow: none; margin: 0; } }
</style>
</head>
<body>
<main data-service="${escapeHtml(model.serviceKind)}" data-address="${escapeHtml(model.addressForm)}">
  <header>
    <div>
      <p class="brand">${escapeHtml(model.issuer.displayName)}</p>
      <p class="muted">${model.issuer.lines.map((line) => escapeHtml(line)).join("<br>")}</p>
    </div>
    <div class="muted">${escapeHtml(model.documentDateLabel)}</div>
  </header>
  <h1>${escapeHtml(model.title)}</h1>
  <div class="facts">
    ${row("Kunde", model.customerName)}
    ${row("E-Mail", model.customerEmail)}
    ${row("Anschrift", model.customerAddress)}
    ${row("Leistung", model.serviceLabel)}
    ${row("Auszug", model.fromAddress)}
    ${row("Einzug", model.toAddress)}
    ${row("Termin", model.serviceDateLabel)}
    ${row("Gültig bis", model.validUntilLabel)}
  </div>
  ${model.intro.map((p) => `<p>${textBlock(p)}</p>`).join("")}
  ${model.summary ? `<h2>Leistungsumfang</h2><p>${textBlock(model.summary)}</p>` : ""}
  ${scope}
  <table>
    <thead><tr><th>Position</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Betrag</th></tr></thead>
    <tbody>${positions}</tbody>
  </table>
  <div class="total"><span>${escapeHtml(model.totalCaption)}</span><span>${escapeHtml(model.totalLabel)}</span></div>
  <div class="meta">
    ${row("Anzahlung", model.depositLabel)}
    ${row("Rest nach Anzahlung", model.remainderLabel)}
    ${row("Zahlungsart", model.paymentMethodLabel)}
    ${row("Bereits gebucht", model.paidLabel)}
    ${row("Offen", model.openLabel)}
  </div>
  ${model.paymentTerms ? `<p>${textBlock(model.paymentTerms)}</p>` : ""}
  ${model.remarks ? `<h2>Hinweise</h2><p>${textBlock(model.remarks)}</p>` : ""}
  ${model.closing.map((p) => `<p>${textBlock(p)}</p>`).join("")}
  <p class="muted">${escapeHtml(model.taxNote)}</p>
  ${bank}
  <footer>${escapeHtml(model.issuer.displayName)} · Vorlage ${escapeHtml(model.templateVersion)}</footer>
</main>
</body>
</html>`;
}
