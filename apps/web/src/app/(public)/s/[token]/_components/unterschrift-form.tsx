"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  BUTTON_UNTERSCHRIFT_BESTAETIGEN,
  UNTERSCHRIFT_HINWEIS,
  type CustomerPortalContext,
  type UnterschriftArt,
} from "@openclaw-crm/customer-portal-core";
import { SignatureField } from "./signature-pad";
import { formatPortalDate, formatPortalMoney } from "./portal-presentation";
import { stempel } from "./brief";
import { Stempel } from "./brief-teile";

const FEHLER: Record<string, string> = {
  BEREITS_UNTERSCHRIEBEN: "Der Vertrag ist bereits unterschrieben. Bitte laden Sie die Seite neu.",
  KEIN_PDF: "Die Unterschrift ist für diesen Auftrag nicht verfügbar. Bitte laden Sie die Seite neu.",
  KEINE_ANNAHME: "Die Unterschrift ist für diesen Auftrag nicht verfügbar. Bitte laden Sie die Seite neu.",
  BILD_UNGUELTIG: "Die Unterschrift konnte nicht übernommen werden. Bitte zeichnen Sie erneut oder tippen Sie Ihren Namen.",
  ANGEBOT_GEAENDERT: "Ihr Auftrag wurde inzwischen geändert. Bitte laden Sie die Seite neu.",
  PDF_FEHLER: "Das Vertragsdokument konnte gerade nicht erstellt werden. Bitte versuchen Sie es in einer Minute erneut.",
};

/** Formular der freiwilligen Unterschrift nach der Annahme. */
export function UnterschriftForm({
  token,
  ctx,
  onSigned,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onSigned: () => void | Promise<void>;
}) {
  const [art, setArt] = useState<UnterschriftArt>("gezeichnet");
  const [name, setName] = useState(ctx.acceptance?.acceptedFullName ?? ctx.customerDisplayName ?? "");
  const [bild, setBild] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fertig, setFertig] = useState<string | null>(null);

  const bereit = name.trim().length >= 2 && (art === "getippt" || !!bild) && !busy;

  async function absenden() {
    if (!bereit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/unterschrift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          art,
          name: name.trim(),
          bildDataUrl: art === "gezeichnet" ? bild : null,
          annahmeAm: ctx.acceptance?.signedAt ?? "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        setError(FEHLER[body.error?.code ?? ""] ?? "Verbindungsfehler. Bitte versuchen Sie es erneut.");
        return;
      }
      setFertig(new Date().toISOString());
      await Promise.resolve(onSigned());
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setBusy(false);
    }
  }

  if (fertig) {
    const datum = stempel({ signedAt: fertig, unterschriftAt: fertig })[1].datum;
    return (
      <div aria-live="polite" className="portal-unterschrift-fertig">
        <Stempel s={{ art: "unterschrieben", datum }} />
        <div>
          <p className="font-medium">Vielen Dank, Ihr Vertrag ist unterschrieben.</p>
          {ctx.documents.signedContractUrl ? (
            <a className="portal-annahme-vertrag" href={ctx.documents.signedContractUrl} target="_blank" rel="noopener noreferrer">
              Vertrag als PDF öffnen
            </a>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Ihr unterschriebener Vertrag wird gerade bereitgestellt.</p>
          )}
        </div>
      </div>
    );
  }

  const acceptance = ctx.acceptance;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed">{UNTERSCHRIFT_HINWEIS}</p>
      {acceptance && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Auftrag {ctx.dealNumber} · {formatPortalMoney(acceptance.confirmedTotalCents)}
          {ctx.scope.moveDate ? ` · Termin ${formatPortalDate(ctx.scope.moveDate)}` : ""}
        </p>
      )}

      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Vollständiger Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
        />
      </label>

      {art === "gezeichnet" ? (
        <SignatureField onChange={setBild} />
      ) : (
        <div className="portal-signature-flaeche portal-signature-typed" aria-label="Vorschau der getippten Unterschrift">
          {name.trim() || "Ihr Name"}
        </div>
      )}
      <button type="button" className="portal-link-button" onClick={() => setArt(art === "gezeichnet" ? "getippt" : "gezeichnet")}>
        {art === "gezeichnet" ? "Lieber tippen" : "Lieber zeichnen"}
      </button>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <button type="button" onClick={absenden} disabled={!bereit} className="portal-button portal-button-unterschrift w-full">
        {busy && <Loader2 size={18} className="animate-spin" aria-hidden />}
        {busy ? "Wird unterschrieben …" : BUTTON_UNTERSCHRIFT_BESTAETIGEN}
      </button>
    </div>
  );
}
