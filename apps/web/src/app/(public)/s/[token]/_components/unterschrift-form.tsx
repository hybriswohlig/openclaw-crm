"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  BUTTON_UNTERSCHRIFT_BESTAETIGEN,
  UNTERSCHRIFT_HINWEIS,
  type CustomerPortalContext,
  type UnterschriftArt,
} from "@openclaw-crm/customer-portal-core";
import { SignatureField } from "./signature-pad";
import { formatPortalDate, formatPortalMoney } from "./portal-presentation";

const FEHLER: Record<string, string> = {
  BEREITS_UNTERSCHRIEBEN: "Der Vertrag ist bereits unterschrieben. Bitte laden Sie die Seite neu.",
  KEIN_PDF: "Die Unterschrift ist für diesen Auftrag nicht verfügbar. Bitte laden Sie die Seite neu.",
  KEINE_ANNAHME: "Die Unterschrift ist für diesen Auftrag nicht verfügbar. Bitte laden Sie die Seite neu.",
  BILD_UNGUELTIG: "Die Unterschrift konnte nicht übernommen werden. Bitte zeichnen Sie erneut oder tippen Sie Ihren Namen.",
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
  const [fertig, setFertig] = useState(false);

  const bereit = name.trim().length >= 2 && (art === "getippt" || !!bild) && !busy;

  async function absenden() {
    if (!bereit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/unterschrift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ art, name: name.trim(), bildDataUrl: art === "gezeichnet" ? bild : null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        setError(FEHLER[body.error?.code ?? ""] ?? "Verbindungsfehler. Bitte versuchen Sie es erneut.");
        return;
      }
      setFertig(true);
      await Promise.resolve(onSigned());
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setBusy(false);
    }
  }

  if (fertig) {
    return (
      <div aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 size={17} aria-hidden />
          Vielen Dank, Ihr Vertrag ist unterschrieben.
        </p>
        {ctx.documents.signedContractUrl ? (
          <a className="mt-2 inline-block font-medium underline underline-offset-2" href={ctx.documents.signedContractUrl} target="_blank" rel="noopener noreferrer">
            Vertrag als PDF öffnen
          </a>
        ) : (
          <p className="mt-1 text-xs">Ihr unterschriebener Vertrag wird gerade bereitgestellt.</p>
        )}
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

      <div role="group" aria-label="Art der Unterschrift" className="grid grid-cols-2 gap-2">
        {(["gezeichnet", "getippt"] as const).map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={art === a}
            onClick={() => setArt(a)}
            className={`h-10 rounded-lg border text-sm font-medium ${art === a ? "border-foreground bg-foreground text-background" : "border-border bg-card"}`}
          >
            {a === "gezeichnet" ? "Zeichnen" : "Tippen"}
          </button>
        ))}
      </div>

      {art === "gezeichnet" ? (
        <SignatureField onChange={setBild} />
      ) : (
        <div className="portal-signature-typed" aria-label="Vorschau der getippten Unterschrift">
          {name.trim() || "Ihr Name"}
        </div>
      )}

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <button type="button" onClick={absenden} disabled={!bereit} className="portal-button w-full disabled:opacity-40">
        {busy && <Loader2 size={18} className="animate-spin" aria-hidden />}
        {busy ? "Wird unterschrieben …" : BUTTON_UNTERSCHRIFT_BESTAETIGEN}
      </button>
    </div>
  );
}
