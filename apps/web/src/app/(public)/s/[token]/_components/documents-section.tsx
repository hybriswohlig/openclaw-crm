"use client";

import { FileText, Download, ExternalLink, CheckCircle2 } from "lucide-react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { EmailDocumentButton } from "./email-document-button";
import { PanelHeading } from "./portal-ui";

export function DocumentsSection({ ctx, token, preview = false }: { ctx: CustomerPortalContext; token: string; preview?: boolean }) {
  const docs = [
    { title: "Kostenvoranschlag", url: ctx.documents.quotationUrl },
    { title: "Auftragsbestätigung", url: ctx.documents.orderConfirmationUrl },
    { title: "Rechnung", url: ctx.documents.invoiceUrl },
  ].filter((doc): doc is { title: string; url: string } => !!doc.url);
  if (!docs.length && !ctx.acceptance) return null;
  return <section className="portal-panel">
    <PanelHeading icon={FileText} title={preview && docs.length === 1 ? `Ihre ${docs[0].title}` : "Ihre Dokumente"}><p>{docs.length ? "Alle wichtigen Unterlagen zu Ihrem Auftrag." : "Ihre Auftragsbestätigung wird vorbereitet und erscheint hier, sobald sie verfügbar ist."}</p></PanelHeading>
    {ctx.acceptance && <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 size={17} className="text-emerald-600" aria-hidden />Angebot angenommen am {new Date(ctx.acceptance.signedAt).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</p>}
    <div className="portal-stack">{docs.map(doc => <div key={doc.title}>
      {preview && <iframe title={`${doc.title} PDF-Vorschau`} src={doc.url} className="portal-document-frame" loading="lazy" />}
      <div className="portal-document-actions"><a className="portal-button" href={doc.url} download><Download size={18} aria-hidden />{doc.title} als PDF herunterladen</a><a className="portal-button portal-button-secondary" href={doc.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} aria-hidden />PDF öffnen</a></div>
      <EmailDocumentButton key={doc.url} ctx={ctx} token={token} url={doc.url} />
    </div>)}</div>
  </section>;
}
