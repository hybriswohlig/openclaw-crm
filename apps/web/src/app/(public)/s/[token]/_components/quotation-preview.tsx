"use client";

import { FileText, Printer, Download } from "lucide-react";
import { pickDefaultDealOption, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { EmailDocumentButton } from "./email-document-button";
import { PanelHeading } from "./portal-ui";
import { formatPortalDate, formatPortalMoney } from "./portal-presentation";

/** Current stored PDF, with a printable data-backed fallback while it is being prepared. */
export function QuotationPreview({ ctx, token }: { ctx: CustomerPortalContext; token: string }) {
  if (!ctx.kva) return null;
  if (ctx.documents.quotationUrl) return <section className="portal-panel" id="portal-quotation-preview">
    <PanelHeading icon={FileText} title="Ihr Kostenvoranschlag"><p>Hier finden Sie Ihr aktuelles Angebot als PDF.</p></PanelHeading>
    <iframe title="Kostenvoranschlag PDF-Vorschau" src={ctx.documents.quotationUrl} className="portal-document-frame" loading="lazy" />
    <a className="portal-button mt-3" href={ctx.documents.quotationUrl} download><Download size={18} aria-hidden />Kostenvoranschlag als PDF herunterladen</a>
    <EmailDocumentButton key={ctx.documents.quotationUrl} ctx={ctx} token={token} url={ctx.documents.quotationUrl} />
  </section>;
  const option = pickDefaultDealOption(ctx.dealPackageOffers.options, ctx.dealPackageOffers.selectedOptionId);
  const total = option?.priceCents && option.priceCents > 0 ? option.priceCents : ctx.kva.totalCents;
  const inclusions = option?.includedItems ?? ctx.inclusions.included.map(item => [item.label, item.detail].filter(Boolean).join(": "));
  return <section className="portal-panel" id="portal-quotation-preview">
    <PanelHeading icon={FileText} title={`Kostenvoranschlag${option ? ` (${option.displayName})` : ""}`}><p>Ihr aktuelles Angebot im Überblick. Über die Druckansicht können Sie es auch als PDF speichern.</p></PanelHeading>
    <div className="portal-quotation-scroll" role="region" aria-label="Kostenvoranschlag lesen" tabIndex={0}><article className="portal-document-paper portal-quotation">
      <header>{ctx.branding.logoUrl ?
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ctx.branding.logoUrl} alt={ctx.branding.displayName} /> : <strong>{ctx.branding.displayName}</strong>}
        {ctx.branding.footer && <p className="max-w-52 text-right text-[10px]">{ctx.branding.footer}</p>}
      </header>
      <h3>Kostenvoranschlag</h3>
      <p>Auftragsnummer: {ctx.dealNumber}</p>
      {ctx.customerDisplayName && <p>Für: {ctx.customerDisplayName}</p>}
      {ctx.scope.moveDate && <p>Umzugstermin: {formatPortalDate(ctx.scope.moveDate)}{ctx.scope.timeStart && `, ab ${ctx.scope.timeStart} Uhr`}</p>}
      {(ctx.scope.fromAddress || ctx.scope.toAddress) && <div className="my-4 grid gap-3 sm:grid-cols-2">{ctx.scope.fromAddress && <p><strong>Abholung</strong><br />{ctx.scope.fromAddress}{ctx.scope.floorsFrom != null && <span className="block">{ctx.scope.floorsFrom === 0 ? "Erdgeschoss" : `${ctx.scope.floorsFrom}. OG`}</span>}{ctx.scope.accessFrom && <span className="block">{ctx.scope.accessFrom}</span>}</p>}{ctx.scope.toAddress && <p><strong>Ziel</strong><br />{ctx.scope.toAddress}{ctx.scope.floorsTo != null && <span className="block">{ctx.scope.floorsTo === 0 ? "Erdgeschoss" : `${ctx.scope.floorsTo}. OG`}</span>}{ctx.scope.accessTo && <span className="block">{ctx.scope.accessTo}</span>}</p>}</div>}
      {ctx.kva.summary && <p className="mt-4 whitespace-pre-line">{ctx.kva.summary}</p>}
      {ctx.kva.isVariable && ctx.kva.lineItems.length ? <table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Betrag</th></tr></thead><tbody>{ctx.kva.lineItems.map((item, i) => <tr key={i}><td>{item.description}<span className="block text-[10px]">{formatPortalMoney(Math.round(item.unitRate * 100))} je Einheit</span></td><td>{item.quantity}</td><td>{formatPortalMoney(Math.round(item.lineTotal * 100))}</td></tr>)}</tbody></table> : inclusions.length > 0 && <table><thead><tr><th>Vereinbarte Leistungen{option && ` · ${option.displayName}`}</th></tr></thead><tbody>{inclusions.map((item, i) => <tr key={i}><td style={{ textAlign: "left", whiteSpace: "normal" }}>{item}</td></tr>)}</tbody></table>}
      {option && option.excludedItems.length > 0 && <p className="mt-4"><strong>Nicht enthalten:</strong> {option.excludedItems.join("; ")}</p>}
      {option && option.addableItems.length > 0 && <p className="mt-3"><strong>Auf Wunsch zubuchbar:</strong> {option.addableItems.join("; ")}</p>}
      {option?.note && <p className="mt-3 whitespace-pre-line">{option.note}</p>}
      <div className="portal-document-total"><span>{ctx.kva.isVariable ? "Voraussichtlicher Gesamtbetrag" : "Gesamtbetrag"}</span><strong className="portal-price">{formatPortalMoney(total)}</strong></div>
      {!!ctx.kva.depositRequiredCents && <p className="mt-3">Vereinbarte Anzahlung: {formatPortalMoney(ctx.kva.depositRequiredCents)}</p>}
      {ctx.kva.validUntil && <p className="mt-3">Gültig bis: {formatPortalDate(ctx.kva.validUntil)}</p>}
      {(ctx.scope.specialRequests || ctx.scope.inventoryNotes) && <p className="mt-4 whitespace-pre-line"><strong>Besonderheiten</strong><br />{[ctx.scope.specialRequests, ctx.scope.inventoryNotes].filter(Boolean).join("\n")}</p>}
      {ctx.kva.calculationAssumptions && <div className="mt-4"><strong>Kalkulationsgrundlagen</strong><ul>{Object.entries(ctx.kva.calculationAssumptions).filter(([, value]) => value != null && value !== "").map(([key, value]) => <li key={key}>{({ anfahrtMinuten: "Anfahrt gesamt (Minuten)", anfahrtQuelle: "Grundlage der Anfahrt", etageVon: "Etage Abholung", etageBis: "Etage Ziel", zugangVon: "Zugang Abholung", zugangBis: "Zugang Ziel", inventarPositionen: "Inventarpositionen", inventarVolumenCbm: "Inventarvolumen (m³)", hinweis: "Hinweis" } as Record<string, string>)[key] ?? key}: {String(value)}</li>)}</ul></div>}
      {ctx.branding.agbPdfUrl && <p className="mt-4"><a href={ctx.branding.agbPdfUrl} className="underline">Allgemeine Geschäftsbedingungen</a></p>}
      {ctx.kva.notes && <p className="mt-4 whitespace-pre-line">{ctx.kva.notes}</p>}
    </article></div>
    <div className="portal-document-actions"><button type="button" className="portal-button" onClick={() => window.print()}><Printer size={18} aria-hidden />Drucken / als PDF speichern</button></div>
  </section>;
}
