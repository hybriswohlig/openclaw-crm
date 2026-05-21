"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Loader2, Copy, Check } from "lucide-react";

type Snippet = "kva_available" | "ab_available" | "deposit_request" | "stage_3_live" | "final_invoice";

interface LinkInfo {
  token: string | null;
  url: string | null;
  skipped?: boolean;
}

/**
 * Compact dropdown next to the AI-sparkle button in the inbox. Mints (or
 * fetches) the customer status link for the deal, lets the operator pick a
 * message template, and either copies the rendered text or inserts it into
 * the composer textarea via the `onInsert` callback.
 *
 * Stays out of the page-level state — the inbox page passes the deal ID and
 * a textarea-insert callback. No coupling.
 */
export function CustomerLinkComposer({
  dealRecordId,
  firmaDisplayName,
  customerFirstName,
  dealNumber,
  onInsert,
}: {
  dealRecordId: string;
  firmaDisplayName: string | null;
  customerFirstName: string | null;
  dealNumber: string | null;
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [snippet, setSnippet] = useState<Snippet>("kva_available");
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load link when popover opens. Idempotent on the backend.
  const ensure = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/customer-link/${dealRecordId}`, { method: "POST" });
      if (res.ok) {
        const json = (await res.json()) as { data: LinkInfo };
        setLink(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    if (open && !link && !loading) void ensure();
  }, [open, link, loading, ensure]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const message = link?.url
    ? renderSnippet(snippet, {
        url: link.url,
        firmaName: firmaDisplayName ?? "wir",
        customerFirstName,
        dealNumber: dealNumber ?? "Ihrem Auftrag",
      })
    : "";

  async function copyMessage() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Status-Link einfügen"
        aria-label="Status-Link einfügen"
      >
        <Link2 className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-80 rounded-xl border border-border bg-popover p-3 shadow-lg">
          <div className="text-xs font-medium text-muted-foreground">
            Kunden-Status-Link
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Link wird vorbereitet…
            </div>
          ) : !link?.url ? (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {link?.skipped
                ? "Das Status-Portal ist für diese Firma in den Einstellungen deaktiviert."
                : "Kein Link verfügbar. Speichere zuerst einen Kostenvoranschlag auf dem Lead."}
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly
                  value={link.url}
                  onClick={(e) => e.currentTarget.select()}
                  className="h-8 flex-1 truncate rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground"
                />
              </div>

              <div className="mt-3">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Vorlage
                </label>
                <select
                  value={snippet}
                  onChange={(e) => setSnippet(e.target.value as Snippet)}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="kva_available">Kostenvoranschlag verfügbar</option>
                  <option value="deposit_request">Anzahlung erbeten</option>
                  <option value="ab_available">Auftragsbestätigung verfügbar</option>
                  <option value="stage_3_live">Live-Update am Umzugstag</option>
                  <option value="final_invoice">Rechnung + Zahlung</option>
                </select>
              </div>

              <pre className="mt-2 max-h-28 overflow-y-auto rounded-md bg-muted/50 p-2 font-sans text-[11px] leading-relaxed whitespace-pre-wrap">
                {message}
              </pre>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={copyMessage}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Kopiert" : "Kopieren"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onInsert(message);
                    setOpen(false);
                  }}
                  className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-foreground text-xs font-medium text-background hover:opacity-90"
                >
                  In Chat einfügen
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function renderSnippet(
  s: Snippet,
  ctx: { url: string; firmaName: string; customerFirstName: string | null; dealNumber: string }
): string {
  const greeting = ctx.customerFirstName ? `Hallo ${ctx.customerFirstName},` : "Hallo,";
  const sign = `\n\nViele Grüße\n${ctx.firmaName}`;
  switch (s) {
    case "kva_available":
      return `${greeting}\n\nIhr Kostenvoranschlag zum Auftrag ${ctx.dealNumber} ist abrufbar. Über den folgenden Link sehen Sie den genauen Umfang und können das Angebot mit einem Klick verbindlich annehmen:\n\n${ctx.url}${sign}`;
    case "deposit_request":
      return `${greeting}\n\nVielen Dank für die Bestätigung! Um den Termin verbindlich zu reservieren, benötigen wir noch Ihre Anzahlung. Sie können bequem über folgenden Link bezahlen (Überweisung per QR-Code oder PayPal):\n\n${ctx.url}\n\nSobald die Zahlung bei uns eingegangen ist, erhalten Sie automatisch die Auftragsbestätigung.${sign}`;
    case "ab_available":
      return `${greeting}\n\nIhre Auftragsbestätigung zu ${ctx.dealNumber} ist soeben fertig geworden. Den vollständigen Vertrag, Termin, Crew und alle Details finden Sie hier:\n\n${ctx.url}${sign}`;
    case "stage_3_live":
      return `${greeting}\n\nUnser Team ist heute für Sie unterwegs. Über den folgenden Link sehen Sie live alle Bilder und Updates vom Umzug:\n\n${ctx.url}\n\nSollten Sie Fragen haben, sind wir jederzeit per WhatsApp über den Link erreichbar.${sign}`;
    case "final_invoice":
      return `${greeting}\n\nVielen Dank für den reibungslosen Umzug! Ihre Rechnung sowie die Möglichkeit zur sofortigen Überweisung per QR-Code finden Sie hier:\n\n${ctx.url}\n\nÜber eine Google-Bewertung würden wir uns sehr freuen — auch dort führt der Link direkt zum richtigen Formular.${sign}`;
  }
}
