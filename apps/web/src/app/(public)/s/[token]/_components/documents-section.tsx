"use client";

import { useEffect, useState } from "react";
import { FileText, Download, ExternalLink, CheckCircle2 } from "lucide-react";
import { kundenText, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { EmailDocumentButton } from "./email-document-button";
import { ensurePortalSession, withPortalSession } from "./portal-session-client";
import { PanelHeading } from "./portal-ui";

export function DocumentsSection({ ctx, token, preview = false }: { ctx: CustomerPortalContext; token: string; preview?: boolean }) {
  const [sid, setSid] = useState<string | null>(null);
  useEffect(() => {
    setSid(ensurePortalSession(token));
  }, [token]);
  const docs = [
    { title: "Unterschriebener Vertrag", url: ctx.documents.signedContractUrl },
    { title: "Kostenvoranschlag", url: ctx.documents.quotationUrl },
    { title: "Auftragsbestätigung", url: ctx.documents.orderConfirmationUrl },
    { title: "Rechnung", url: ctx.documents.invoiceUrl },
  ].filter((doc): doc is { title: string; url: string } => !!doc.url);
  if (!docs.length && !ctx.acceptance) return null;
  const t = (sie: string, du: string) => kundenText(ctx.branding.firmaSlug, sie, du);
  return <section className="portal-panel">
    <PanelHeading icon={FileText} title={preview && docs.length === 1 ? t(`Ihre ${docs[0].title}`, `Deine ${docs[0].title}`) : t("Ihre Dokumente", "Deine Dokumente")}><p>{docs.length ? t("Alle wichtigen Unterlagen zu Ihrem Auftrag.", "Alle wichtigen Unterlagen zu deinem Auftrag.") : t("Ihre Auftragsbestätigung wird vorbereitet und erscheint hier, sobald sie verfügbar ist.", "Deine Auftragsbestätigung wird vorbereitet und erscheint hier, sobald sie verfügbar ist.")}</p></PanelHeading>
    {ctx.acceptance && <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 size={17} className="text-[var(--portal-brand)]" aria-hidden />Angebot angenommen am {new Date(ctx.acceptance.signedAt).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</p>}
    <div className="portal-stack">{docs.map(doc => <div key={doc.title}>
      {preview && sid && <iframe title={`${doc.title} PDF-Vorschau`} src={withPortalSession(doc.url, sid)} className="portal-document-frame" loading="lazy" />}
      <div className="portal-document-actions"><a className="portal-button" href={withPortalSession(doc.url, sid, { dl: "1" })} download><Download size={18} aria-hidden />{doc.title} als PDF herunterladen</a><a className="portal-button portal-button-secondary" href={withPortalSession(doc.url, sid)} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} aria-hidden />PDF öffnen</a></div>
      <EmailDocumentButton key={doc.url} ctx={ctx} token={token} url={doc.url} />
    </div>)}</div>
  </section>;
}
