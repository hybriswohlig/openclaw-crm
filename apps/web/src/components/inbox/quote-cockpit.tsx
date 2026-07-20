"use client";

/**
 * Quote-Cockpit — inline Angebots-Karte im Inbox-Kontextpanel (ersetzt das
 * frühere Kostenrechner-Modal). Kombiniert die kompakte Zeitschätzung
 * (Google-Routen-Berechnung aus der Auftragsübersicht) mit dem
 * QuotationCalculator. Die Sichtbarkeitsregel (nur vor Zahlung / nicht bei
 * verlorenen Deals) liegt beim Aufrufer (context-panel.tsx).
 *
 * Lazy: der Auftrag wird erst beim Aufklappen geladen, denn GET /auftrag legt
 * den Auftrags-Datensatz bei Bedarf an — das soll nicht beim bloßen Öffnen
 * einer Konversation passieren.
 */

import { useCallback, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, RefreshCw, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuotationCalculator } from "@/components/quotation/quotation-calculator";

type QuotationProp = React.ComponentProps<typeof QuotationCalculator>["quotation"];

interface TimeEstimate {
  driveMinutesTotal: number | null;
  loadUnloadMinutes: number | null;
  totalMinutes: number | null;
  computedAt: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function QuoteCockpit({
  dealRecordId,
  quotation,
  onSaved,
}: {
  dealRecordId: string;
  quotation: QuotationProp;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState<TimeEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const loadAuftrag = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/auftrag`);
      if (!res.ok) return;
      const j = (await res.json()) as {
        data?: { auftrag?: { values?: Record<string, unknown> } | null };
      };
      const v = j.data?.auftrag?.values ?? {};
      const seg = (v.drive_segments_json ?? null) as {
        pickupAddress?: string;
        dropoffAddress?: string;
      } | null;
      const drive = asNumber(v.drive_minutes_total);
      if (drive != null) {
        setEstimate({
          driveMinutesTotal: drive,
          loadUnloadMinutes: asNumber(v.load_unload_minutes),
          totalMinutes: asNumber(v.total_minutes),
          computedAt: typeof v.time_estimate_computed_at === "string" ? v.time_estimate_computed_at : null,
          pickupAddress: seg?.pickupAddress ?? null,
          dropoffAddress: seg?.dropoffAddress ?? null,
        });
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [dealRecordId]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) void loadAuftrag();
  }

  async function runEstimate() {
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/auftrag/estimate-time`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: {
          driveMinutesTotal?: number;
          loadUnloadMinutes?: number;
          totalMinutes?: number;
          computedAt?: string;
          pickupAddress?: string;
          dropoffAddress?: string;
        };
        error?: string;
        code?: string;
      };
      if (!res.ok || !j.data) {
        setEstimateError(
          j.code === "MISSING_ADDRESSES"
            ? "Adressen fehlen — per KI-Analyse extrahieren oder im Lead ergänzen."
            : j.code === "no_api_key"
              ? "Google-Maps-API-Key fehlt (GOOGLE_MAPS_API_KEY)."
              : (j.error ?? `Berechnung fehlgeschlagen (${res.status})`)
        );
        return;
      }
      setEstimate({
        driveMinutesTotal: j.data.driveMinutesTotal ?? null,
        loadUnloadMinutes: j.data.loadUnloadMinutes ?? null,
        totalMinutes: j.data.totalMinutes ?? null,
        computedAt: j.data.computedAt ?? null,
        pickupAddress: j.data.pickupAddress ?? null,
        dropoffAddress: j.data.dropoffAddress ?? null,
      });
    } finally {
      setEstimating(false);
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Calculator className="h-4 w-4" />
        <span className="font-medium">Kostenrechner & Route</span>
        {!expanded && quotation?.fixedPrice && (
          <span className="ml-auto text-xs text-muted-foreground">
            {Number(quotation.fixedPrice).toFixed(2)} €
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-4 pt-1">
          {/* ── Kompakte Zeitschätzung ── */}
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Route className="h-3.5 w-3.5" />
                Route & Zeit
              </span>
              <button
                onClick={() => void runEstimate()}
                disabled={estimating || loading}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", estimating && "animate-spin")} />
                {estimate ? "Aktualisieren" : "Berechnen"}
              </button>
            </div>
            {loading ? (
              <p className="text-[11px] text-muted-foreground">Lade Auftrag…</p>
            ) : estimate ? (
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
                {estimate.pickupAddress && estimate.dropoffAddress && (
                  <p className="truncate">
                    {estimate.pickupAddress} → {estimate.dropoffAddress}
                  </p>
                )}
                <p>
                  Fahrt gesamt:{" "}
                  <span className="font-medium text-foreground">
                    {estimate.driveMinutesTotal != null ? formatMinutes(estimate.driveMinutesTotal) : "—"}
                  </span>
                  {estimate.loadUnloadMinutes != null && (
                    <>
                      {" · "}Laden/Entladen:{" "}
                      <span className="font-medium text-foreground">
                        {formatMinutes(estimate.loadUnloadMinutes)}
                      </span>
                    </>
                  )}
                </p>
                {estimate.totalMinutes != null && (
                  <p>
                    Gesamtzeit:{" "}
                    <span className="font-medium text-foreground">
                      {formatMinutes(estimate.totalMinutes)}
                    </span>
                    {estimate.computedAt && (
                      <span className="ml-1 text-[10px]">
                        (Stand {new Date(estimate.computedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })})
                      </span>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Noch keine Zeitschätzung — mit „Berechnen" Route & Dauer via Google Maps ermitteln.
              </p>
            )}
            {estimateError && (
              <p className="mt-1.5 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                {estimateError}
              </p>
            )}
          </div>

          {/* ── Preis-Formular (identisch zur Auftragsübersicht) ── */}
          <QuotationCalculator recordId={dealRecordId} quotation={quotation} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}
