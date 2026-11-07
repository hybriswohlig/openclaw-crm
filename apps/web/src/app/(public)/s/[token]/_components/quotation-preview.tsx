"use client";

import { FileText, Printer, Download } from "lucide-react";
import { angezeigterPreis, annahmeKvSperre, kundenText, logoFuer, pickDefaultDealOption, stundenAnzeige, stundensatzText, stundenVersionText, tagKurz, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { EmailDocumentButton } from "./email-document-button";
import { PanelHeading } from "./portal-ui";
import { formatPortalDate, formatPortalMoney } from "./portal-presentation";
import { kundenAnnahmen } from "@/lib/kunden-annahmen";
import { RestbetragHinweis } from "./restbetrag-hinweis";
import { adressZeilen, annahmenLabels, worte } from "./leistung-worte";

/**
 * Current stored PDF. Without one, the same deal data is a readable HTML
 * paper on screen, and Drucken still prints that paper.
 * `kva.notes` is an internal operator note and is never rendered.
 * Passt das PDF nicht zur aktuellen Version (vor der Annahme), zeigt die
 * Stufe 1 statt des PDFs dieses Papier mit dem aktuellen Preis.
 */
export function QuotationPreview({ ctx, token, variant = "full", emailImBrief = false }: { ctx: CustomerPortalContext; token: string; variant?: "full" | "file"; emailImBrief?: boolean }) {
  if (!ctx.kva) return null;
  const t = (sie: string, du: string) => kundenText(ctx.branding.firmaSlug, sie, du);
  const kvVeraltet = !ctx.acceptance && !!annahmeKvSperre(ctx.annahmeRecht.kvStand);
  const pdfFolgt = kvVeraltet ? " Das PDF dazu erstellen wir gerade neu." : "";
  if (ctx.documents.quotationUrl && !kvVeraltet) return <section className="portal-panel" id="portal-quotation-preview">
    <PanelHeading icon={FileText} title={t("Ihr Kostenvoranschlag", "Dein Kostenvoranschlag")}><p>{t("Hier finden Sie Ihr aktuelles Angebot als PDF.", "Hier findest du dein aktuelles Angebot als PDF.")}</p></PanelHeading>
    <iframe title="Kostenvoranschlag PDF-Vorschau" src={ctx.documents.quotationUrl} className="portal-document-frame" loading="lazy" />
    <a className="portal-button mt-3" href={ctx.documents.quotationUrl} download><Download size={18} aria-hidden />Kostenvoranschlag als PDF herunterladen</a>
    <EmailDocumentButton key={ctx.documents.quotationUrl} ctx={ctx} token={token} url={ctx.documents.quotationUrl} ohneErfassung={emailImBrief} />
  </section>;
  const option = variant === "file" ? null : pickDefaultDealOption(ctx.dealPackageOffers.options, ctx.dealPackageOffers.selectedOptionId);
  // Aktueller Stand (nicht der angenommene), Preis wie Preiskarte und Server: mit Tagespreisen am gewählten Tag.
  const preis = angezeigterPreis({ ...ctx, acceptance: null, dealPackageOffers: option ? ctx.dealPackageOffers : { options: [], selectedOptionId: null } });
  const total = preis.cents;
  const stunden = stundenAnzeige(ctx.kva);
  // Stunden-KV aus der Version: Helfer- und Transporterzeilen sind Sätze je Stunde, nicht Teil der Summe (K12).
  const stundenZeile = (item: { type: string }) => stunden?.modell === "version" && (item.type === "helper" || item.type === "transporter");
  // Ohne Transporter (z. B. Entrümpelung) keine Zeile „Transporter 0“.
  const positions = ctx.kva.lineItems.filter(item => item.description.trim() && !(stundenZeile(item) && item.quantity === 0));
  // Plan 5b: Pakete aus der Version tragen die Posten des gewählten Pakets (Summe = Preis), K8.
  const postenDerWahl = !!option && !!ctx.kva.calculationVersionId && positions.length > 0 &&
    positions.reduce((s, p) => s + Math.round(p.lineTotal * 100), 0) === total;
  // Kalkulationsgrundlagen nur mit mindestens einer Angabe (der Server lässt Rechner-Hinweise schon weg).
  const grundlagen = Object.entries(kundenAnnahmen(ctx.kva.calculationAssumptions) ?? {}).filter(([key, value]) => value != null && value !== "" && annahmenLabels(ctx)[key] !== null);
  const standardInclusions = ctx.kva.showStandardInclusions
    ? ctx.inclusions.included.map(item => [item.label, item.detail].filter(Boolean).join(": "))
    : [];
  const inclusions = option?.includedItems ?? (positions.length > 0 ? [] : standardInclusions);
  const logo = logoFuer(ctx.branding, ctx.annahmeRecht.serviceType);
  const paper = <article className="portal-document-paper portal-quotation">
      <header>{logo ?
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={ctx.branding.displayName} /> : <strong>{ctx.branding.displayName}</strong>}
        {ctx.branding.footer && <p className="max-w-52 text-right text-[10px]">{ctx.branding.footer}</p>}
      </header>
      <h3>Kostenvoranschlag</h3>
      <p>Auftragsnummer: {ctx.dealNumber}</p>
      {ctx.customerDisplayName && <p>Für: {ctx.customerDisplayName}</p>}
      {ctx.scope.moveDate && <p>{worte(ctx).termin}: {formatPortalDate(ctx.scope.moveDate)}{ctx.scope.timeStart && `, ab ${ctx.scope.timeStart} Uhr`}</p>}
      {adressZeilen(ctx).length > 0 && <div className="my-4 grid gap-3 sm:grid-cols-2">{adressZeilen(ctx).map((a) => <p key={a.key}><strong>{a.label}</strong><br />{a.adresse}{a.etage != null && <span className="block">{a.etage === 0 ? "Erdgeschoss" : `${a.etage}. OG`}</span>}{a.zugang && <span className="block">{a.zugang}</span>}</p>)}</div>}
      {ctx.kva.summary && <p className="mt-4 whitespace-pre-line">{ctx.kva.summary}</p>}
      {positions.length > 0 && (!option || postenDerWahl) ? <table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Betrag</th></tr></thead><tbody>{positions.map((item, i) => <tr key={i}><td>{item.description}</td><td>{item.quantity}</td><td>{formatPortalMoney(Math.round(item.lineTotal * 100))}{stundenZeile(item) && " je Stunde"}</td></tr>)}</tbody></table> : inclusions.length > 0 && <table><thead><tr><th>Vereinbarte Leistungen{option && ` · ${option.displayName}`}</th></tr></thead><tbody>{inclusions.map((item, i) => <tr key={i}><td style={{ textAlign: "left", whiteSpace: "normal" }}>{item}</td></tr>)}</tbody></table>}
      {postenDerWahl && option.includedItems.length > 0 && <p className="mt-4"><strong>{option.displayName} enthält:</strong> {option.includedItems.join("; ")}</p>}
      {option && option.excludedItems.length > 0 && <p className="mt-4"><strong>Nicht enthalten:</strong> {option.excludedItems.join("; ")}</p>}
      {option && option.addableItems.length > 0 && <p className="mt-3"><strong>Auf Wunsch zubuchbar:</strong> {option.addableItems.join("; ")}</p>}
      {option?.note && <p className="mt-3 whitespace-pre-line">{option.note}</p>}
      {stunden?.modell === "alt"
        ? <div className="portal-document-total"><span>Stundensatz</span><strong className="portal-price">{formatPortalMoney(stunden.satzCents)} je Stunde</strong></div>
        : <div className="portal-document-total"><span>{ctx.kva.isVariable ? "Voraussichtlicher Gesamtbetrag" : "Gesamtbetrag"}</span><strong className="portal-price">{formatPortalMoney(total)}</strong></div>}
      {stunden?.modell === "version" && <p className="mt-2">{stundenVersionText(stunden.stunden, formatPortalMoney).replace(/^v/, "V")}.</p>}
      {stunden?.modell === "alt" && <p className="mt-2">{stundensatzText(stunden.satzCents, formatPortalMoney)}, abgerechnet nach tatsächlichem Aufwand.</p>}
      {preis.tag && <p className="mt-2">{preis.tagGewaehlt ? `Preis an diesem Tag: ${tagKurz(preis.tag.date)}` : `Preis am empfohlenen Termin ${tagKurz(preis.tag.date)} Mit der Terminwahl kann er sich ändern.`}</p>}
      {!!ctx.kva.depositRequiredCents && <p className="mt-3">Vereinbarte Anzahlung: {formatPortalMoney(ctx.kva.depositRequiredCents)}</p>}
      <RestbetragHinweis firmaSlug={ctx.branding.firmaSlug} serviceType={ctx.annahmeRecht.serviceType} className="mt-3" />
      {ctx.kva.validUntil && <p className="mt-3">Gültig bis: {formatPortalDate(ctx.kva.validUntil)}</p>}
      {(ctx.scope.specialRequests || ctx.scope.inventoryNotes) && <p className="mt-4 whitespace-pre-line"><strong>Besonderheiten</strong><br />{[ctx.scope.specialRequests, ctx.scope.inventoryNotes].filter(Boolean).join("\n")}</p>}
      {grundlagen.length > 0 && <div className="mt-4"><strong>Kalkulationsgrundlagen</strong><ul>{grundlagen.map(([key, value]) => <li key={key}>{annahmenLabels(ctx)[key] ?? key}: {String(value)}</li>)}</ul></div>}
      {ctx.branding.agbPdfUrl && <p className="mt-4"><a href={ctx.branding.agbPdfUrl} className="underline">Allgemeine Geschäftsbedingungen</a></p>}
    </article>;
  if (variant === "file") return <section className="portal-panel" id="portal-quotation-preview">
    <PanelHeading icon={FileText} title="Kostenvoranschlag"><p>{t("Sie können Ihr Angebot drucken oder als PDF speichern.", "Du kannst dein Angebot drucken oder als PDF speichern.")}{pdfFolgt}</p></PanelHeading>
    <div className="portal-quotation-scroll" role="region" aria-label="Kostenvoranschlag lesen" tabIndex={0}>{paper}</div>
    <div className="portal-document-actions"><button type="button" className="portal-button" onClick={() => window.print()}><Printer size={18} aria-hidden />Drucken / als PDF speichern</button></div>
  </section>;
  return <section className="portal-panel" id="portal-quotation-preview">
    <PanelHeading icon={FileText} title={`Kostenvoranschlag${option ? ` (${option.displayName})` : ""}`}><p>{t("Ihr aktuelles Angebot im Überblick. Über die Druckansicht können Sie es auch als PDF speichern.", "Dein aktuelles Angebot im Überblick. Über die Druckansicht kannst du es auch als PDF speichern.")}{pdfFolgt}</p></PanelHeading>
    <div className="portal-quotation-scroll" role="region" aria-label="Kostenvoranschlag lesen" tabIndex={0}>{paper}</div>
    <div className="portal-document-actions"><button type="button" className="portal-button" onClick={() => window.print()}><Printer size={18} aria-hidden />Drucken / als PDF speichern</button></div>
  </section>;
}
