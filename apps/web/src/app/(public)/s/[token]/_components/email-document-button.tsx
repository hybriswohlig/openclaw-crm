"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { kundenText, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { hinterlegteEmailLabel } from "@/lib/email-capture-copy";
import { EmailCaptureBanner } from "./email-capture-banner";

export function EmailDocumentButton({ ctx, token, url }: { ctx: CustomerPortalContext; token: string; url: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const firma = ctx.branding.firmaSlug;
  const t = (sie: string, du: string) => kundenText(firma, sie, du);
  const prefix = `/api/public/${token}/documents/`;
  if (!url.startsWith(prefix)) return null;
  if (ctx.customerEmailStatus !== "present" && !masked) return <EmailCaptureBanner token={token} status={ctx.customerEmailStatus} branding={ctx.branding} onSaved={setMasked} />;
  async function send() {
    if (busy || sent) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`${url}/email`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          RATE_LIMITED: t("Bitte warten Sie vor einem erneuten Versand. Pro Auftrag sind maximal fünf Sendungen innerhalb von 24 Stunden möglich.", "Bitte warte vor einem erneuten Versand. Pro Auftrag sind maximal fünf Sendungen innerhalb von 24 Stunden möglich."),
          NO_CUSTOMER_EMAIL: t("Bitte hinterlegen Sie zuerst Ihre E-Mail-Adresse und laden Sie die Seite neu.", "Bitte hinterlege zuerst deine E-Mail-Adresse und lade die Seite neu."),
          DOCUMENT_UNAVAILABLE: t("Dieses Dokument ist nicht mehr aktuell. Bitte laden Sie die Seite neu.", "Dieses Dokument ist nicht mehr aktuell. Bitte lade die Seite neu."),
          UNAVAILABLE: "Dieser Portallink ist nicht mehr verfügbar.",
          DOCUMENT_TOO_LARGE: t("Dieses Dokument ist für den E-Mail-Versand zu groß. Bitte laden Sie es herunter.", "Dieses Dokument ist für den E-Mail-Versand zu groß. Bitte lade es herunter."),
          NO_EMAIL_CHANNEL_ACCOUNT: t("Der E-Mail-Versand ist derzeit nicht eingerichtet. Bitte kontaktieren Sie uns.", "Der E-Mail-Versand ist derzeit nicht eingerichtet. Bitte kontaktiere uns."),
        };
        setError(messages[body.error?.code] ?? t("Der Versand konnte nicht bestätigt werden. Bitte laden Sie das PDF herunter oder kontaktieren Sie uns.", "Der Versand konnte nicht bestätigt werden. Bitte lade das PDF herunter oder kontaktiere uns."));
        return;
      }
      setSent(true);
    } catch { setError(t("Der Versand konnte nicht bestätigt werden. Bitte prüfen Sie Ihr Postfach, bevor Sie es erneut versuchen.", "Der Versand konnte nicht bestätigt werden. Bitte prüfe dein Postfach, bevor du es erneut versuchst.")); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    <button className="portal-button portal-button-secondary w-full" type="button" disabled={busy || sent} onClick={send}>{busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Mail size={18} aria-hidden />}{sent ? "E-Mail versendet" : busy ? "Wird versendet …" : "Per E-Mail senden"}</button>
    <p className="mt-2 text-xs text-muted-foreground" role="status">{sent ? t("Das PDF wurde an Ihre hinterlegte E-Mail-Adresse versendet.", "Das PDF wurde an deine hinterlegte E-Mail-Adresse versendet.") : `Empfänger: ${masked ?? ctx.customerEmailMasked ?? hinterlegteEmailLabel(firma)}`}</p>
    {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
  </div>;
}
