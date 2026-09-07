"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { EmailCaptureBanner } from "./email-capture-banner";

export function EmailDocumentButton({ ctx, token, url }: { ctx: CustomerPortalContext; token: string; url: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
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
          RATE_LIMITED: "Bitte warten Sie vor einem erneuten Versand. Pro Auftrag sind maximal fünf Sendungen innerhalb von 24 Stunden möglich.",
          NO_CUSTOMER_EMAIL: "Bitte hinterlegen Sie zuerst Ihre E-Mail-Adresse und laden Sie die Seite neu.",
          DOCUMENT_UNAVAILABLE: "Dieses Dokument ist nicht mehr aktuell. Bitte laden Sie die Seite neu.",
          UNAVAILABLE: "Dieser Portallink ist nicht mehr verfügbar.",
          DOCUMENT_TOO_LARGE: "Dieses Dokument ist für den E-Mail-Versand zu groß. Bitte laden Sie es herunter.",
          NO_EMAIL_CHANNEL_ACCOUNT: "Der E-Mail-Versand ist derzeit nicht eingerichtet. Bitte kontaktieren Sie uns.",
        };
        setError(messages[body.error?.code] ?? "Der Versand konnte nicht bestätigt werden. Bitte laden Sie das PDF herunter oder kontaktieren Sie uns.");
        return;
      }
      setSent(true);
    } catch { setError("Der Versand konnte nicht bestätigt werden. Bitte prüfen Sie Ihr Postfach, bevor Sie es erneut versuchen."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    <button className="portal-button portal-button-secondary w-full" type="button" disabled={busy || sent} onClick={send}>{busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Mail size={18} aria-hidden />}{sent ? "E-Mail versendet" : busy ? "Wird versendet …" : "Per E-Mail senden"}</button>
    <p className="mt-2 text-xs text-muted-foreground" role="status">{sent ? "Das PDF wurde an Ihre hinterlegte E-Mail-Adresse versendet." : `Empfänger: ${masked ?? ctx.customerEmailMasked ?? "Ihre hinterlegte E-Mail-Adresse"}`}</p>
    {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
  </div>;
}
