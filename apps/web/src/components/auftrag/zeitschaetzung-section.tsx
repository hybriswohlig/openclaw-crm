// apps/web/src/components/auftrag/zeitschaetzung-section.tsx
//
// "Zeitschätzung & Preis-Kalkulator" card in the Auftrags Tab.
//
// - Pulls move_from / move_to LIVE from the Lead (via the estimate-time route);
//   never asks the user to re-type.
// - Calls /api/v1/deals/[recordId]/auftrag/estimate-time which uses Google
//   Distance Matrix (with traffic) for the 3 legs depot → pickup → dropoff
//   → depot.
// - Auto-seeds the sliders from the estimate; user can drag freely from there.
// - For Ceylan: toggles between a single pauschale row and an itemized one.
// - "In AB/RE übernehmen" opens GenerateDocumentDialog with prefill so the
//   user lands on the "PDF erstellen" step with everything pre-filled.

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Truck, ChevronRight } from "lucide-react";
import {
  GenerateDocumentDialog,
  type DealData,
  type DocumentType,
  type PrefilledPreise,
} from "@/components/GenerateDocumentDialog";

interface DriveLeg {
  fromLabel: string;
  toLabel: string;
  meters: number;
  seconds: number;
}

interface EstimateResponse {
  depot: { id: string; name: string };
  legs: DriveLeg[];
  driveMinutesTotal: number;
  loadUnloadMinutes: number;
  totalMinutes: number;
  computedAt: string;
  warnings: string[];
  pickupAddress: string;
  dropoffAddress: string;
}

interface Props {
  recordId: string;
  /** Already-persisted estimate from the Auftrag (so we don't re-call Google on tab open) */
  initial?: {
    depotName: string | null;
    driveMinutesTotal: number | null;
    loadUnloadMinutes: number | null;
    totalMinutes: number | null;
    computedAt: string | null;
    segments: {
      legs?: DriveLeg[];
      pickupAddress?: string;
      dropoffAddress?: string;
      warnings?: string[];
    } | null;
  };
  /** When present, "In AB/RE übernehmen" buttons are enabled. */
  dealData: DealData | null;
}

type CeylanMode = "single" | "itemized";

export function ZeitschaetzungSection({ recordId, initial, dealData }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(() =>
    initial && initial.totalMinutes != null
      ? {
          depot: { id: "", name: initial.depotName ?? "—" },
          legs: initial.segments?.legs ?? [],
          driveMinutesTotal: initial.driveMinutesTotal ?? 0,
          loadUnloadMinutes: initial.loadUnloadMinutes ?? 0,
          totalMinutes: initial.totalMinutes ?? 0,
          computedAt: initial.computedAt ?? "",
          warnings: initial.segments?.warnings ?? [],
          pickupAddress: initial.segments?.pickupAddress ?? "",
          dropoffAddress: initial.segments?.dropoffAddress ?? "",
        }
      : null
  );

  // ── Slider state (auto-seeded from estimate, user can drag) ──────────
  const [helfer, setHelfer] = useState(3);
  const [stunden, setStunden] = useState(4);
  const [helferRate, setHelferRate] = useState(35);
  const [transporterRate, setTransporterRate] = useState(25);
  const [mindestStunden, setMindestStunden] = useState(3);
  const [anzahlungBar, setAnzahlungBar] = useState(0);
  const [stammkundenrabatt, setStammkundenrabatt] = useState(false);
  const [ceylanMode, setCeylanMode] = useState<CeylanMode>("single");

  const [dialogType, setDialogType] = useState<DocumentType | null>(null);

  // Re-seed sliders whenever a fresh estimate lands. Auto-derive starting
  // stunden from total minutes: round up to next half hour.
  useEffect(() => {
    if (!estimate || estimate.totalMinutes <= 0) return;
    const hours = Math.max(mindestStunden, Math.ceil((estimate.totalMinutes / 60) * 2) / 2);
    setStunden(hours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate?.computedAt]);

  async function recompute() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const resp = await fetch(`/api/v1/deals/${recordId}/auftrag/estimate-time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setError(json?.error ?? `HTTP ${resp.status}`);
        return;
      }
      const data = json.data as EstimateResponse;
      setEstimate(data);
      if (data.warnings.length > 0) setWarning(data.warnings.join(" · "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── Pricing math (live) ──────────────────────────────────────────────
  const stundenAbrechnung = Math.max(stunden, mindestStunden);
  const stundensatzGesamt = helfer * helferRate + transporterRate;
  const baseTotal = stundenAbrechnung * stundensatzGesamt;
  const minderung = stammkundenrabatt ? baseTotal * 0.03 : 0;
  const totalEUR = Math.round((baseTotal - minderung) * 100) / 100;

  const isKottke = dealData?.firma === "kottke";

  const itemizedPositionen = useMemo(() => {
    if (isKottke || ceylanMode !== "itemized") return null;
    // Coarse breakdown that mirrors how Ceylan tends to sell:
    const fahrt = Math.round(stundenAbrechnung * transporterRate * 100) / 100;
    const personal = Math.round(stundenAbrechnung * helfer * helferRate * 100) / 100;
    return [
      { titel: "Personal", betrag: personal },
      { titel: "Transporter / Fahrt", betrag: fahrt },
    ];
  }, [isKottke, ceylanMode, stundenAbrechnung, transporterRate, helfer, helferRate]);

  function buildPrefill(): PrefilledPreise {
    if (isKottke) {
      return {
        modell: "stundensatz",
        helferAnzahl: helfer,
        stundenGeschaetzt: stunden,
        helferRate,
        transporterRate,
        mindestStunden,
        anzahlungBar,
      };
    }
    // Ceylan
    if (ceylanMode === "itemized" && itemizedPositionen) {
      return {
        modell: "pauschale",
        pauschalePositionen: itemizedPositionen,
        anzahlungBar,
        stammkundenrabatt,
      };
    }
    return {
      modell: "pauschale",
      pauschaleBetragCeylan: totalEUR,
      anzahlungBar,
      stammkundenrabatt,
    };
  }

  return (
    <section className="rounded-lg border border-border bg-muted/10 p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" /> Zeitschätzung & Preis-Kalkulator
        </h3>
        <button
          type="button"
          onClick={recompute}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {estimate ? "Neu berechnen" : "Berechnen"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {warning && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
          {warning}
        </div>
      )}

      {!estimate && (
        <p className="text-xs text-muted-foreground">
          Adressen werden live vom Lead gezogen. Klick auf <strong>Berechnen</strong>, um die Route
          (Depot → Abholung → Ziel → Depot) und die Be-/Entladezeit zu schätzen.
        </p>
      )}

      {estimate && (
        <>
          {/* ── Route legs ────────────────────────────────── */}
          <div className="rounded-md bg-background p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Route über {estimate.depot.name}
            </div>
            <ol className="space-y-1">
              {estimate.legs.map((leg, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground tabular-nums w-6">{i + 1}.</span>
                  <span className="truncate flex-1">
                    {leg.fromLabel} <ChevronRight className="inline h-3 w-3" /> {leg.toLabel}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatKm(leg.meters)} · {formatMinutes(Math.round(leg.seconds / 60))}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 text-xs">
              <Stat label="Fahrtzeit" value={formatMinutes(estimate.driveMinutesTotal)} />
              <Stat label="Be-/Entladen" value={formatMinutes(estimate.loadUnloadMinutes)} />
              <Stat label="Gesamt" value={formatMinutes(estimate.totalMinutes)} highlight />
            </div>
          </div>

          {/* ── Street View thumbnails (visual context for estimation) ── */}
          {(estimate.pickupAddress || estimate.dropoffAddress) && (
            <div className="grid grid-cols-2 gap-3">
              <StreetViewThumb label="Abholung" address={estimate.pickupAddress} />
              <StreetViewThumb label="Ziel" address={estimate.dropoffAddress} />
            </div>
          )}

          {/* ── Sliders ──────────────────────────────────── */}
          <div className="space-y-3 rounded-md bg-background p-3">
            <Slider
              label="Helfer"
              value={helfer}
              min={1}
              max={6}
              step={1}
              onChange={setHelfer}
              suffix={helfer === 1 ? "Person" : "Personen"}
            />
            <Slider
              label="Stunden"
              value={stunden}
              min={1}
              max={10}
              step={0.5}
              onChange={setStunden}
              suffix="h"
            />
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Helfer-Rate €/h" value={helferRate} onChange={setHelferRate} />
              <NumField label="Transp. €/h" value={transporterRate} onChange={setTransporterRate} />
              <NumField label="Mind.-Std." value={mindestStunden} onChange={setMindestStunden} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Anzahlung bar €" value={anzahlungBar} onChange={setAnzahlungBar} />
              {!isKottke && (
                <label className="flex items-end gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={stammkundenrabatt}
                    onChange={(e) => setStammkundenrabatt(e.target.checked)}
                  />
                  Stammkundenrabatt (3 % Skonto)
                </label>
              )}
            </div>

            {!isKottke && (
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={ceylanMode === "single"}
                    onChange={() => setCeylanMode("single")}
                  />
                  Einzel-Pauschale
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={ceylanMode === "itemized"}
                    onChange={() => setCeylanMode("itemized")}
                  />
                  Itemized (Personal + Fahrt)
                </label>
              </div>
            )}

            {/* ── Live total ────────────────────────────── */}
            <div className="rounded bg-muted/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Voraussichtlicher Gesamtpreis
              </div>
              <div className="text-2xl font-bold tabular-nums">{formatEUR(totalEUR)}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {stundenAbrechnung} h × ({helfer} × {helferRate} € + {transporterRate} €) = {formatEUR(baseTotal)}
                {stammkundenrabatt ? ` − 3 % = ${formatEUR(totalEUR)}` : ""}
              </div>
            </div>
          </div>

          {/* ── Übernehmen-Buttons ───────────────────────── */}
          {dealData && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDialogType("AB")}
                className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
              >
                In Auftragsbestätigung übernehmen
              </button>
              <button
                type="button"
                onClick={() => setDialogType("RE")}
                className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
              >
                In Rechnung übernehmen
              </button>
            </div>
          )}
          {!dealData && (
            <p className="text-[11px] text-muted-foreground">
              Setze <strong>ausführende Firma</strong> und <strong>Kundenname</strong> am Lead, um in eine AB/RE zu übernehmen.
            </p>
          )}
        </>
      )}

      {dealData && dialogType && (
        <GenerateDocumentDialog
          open
          documentType={dialogType}
          deal={dealData}
          prefill={buildPrefill()}
          onClose={() => setDialogType(null)}
        />
      )}
    </section>
  );
}

// ─── tiny presentational helpers ──────────────────────────────────────

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={highlight ? "text-base font-semibold tabular-nums" : "tabular-nums"}>{value}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {value} {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded border px-2 py-1 text-sm"
      />
    </label>
  );
}

/**
 * Wraps an <img> that calls the /api/v1/maps/streetview proxy. On a 204
 * (ZERO_RESULTS) the image stays at 0x0 — we detect that and swap in a
 * neutral placeholder. Falls back silently on any error.
 */
function StreetViewThumb({ label, address }: { label: string; address: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!address) return null;
  const src = `/api/v1/maps/streetview?address=${encodeURIComponent(address)}&width=400&height=250`;
  return (
    <div className="rounded-md border border-border overflow-hidden bg-muted/30">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">
        Street View — {label}
      </div>
      <div className="relative aspect-[8/5] bg-muted/20">
        {!failed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`Street View ${label}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {(failed || !loaded) && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            {failed ? "kein Street View verfügbar" : "lädt…"}
          </div>
        )}
      </div>
      <div className="px-2 py-1 text-[11px] text-muted-foreground truncate">{address}</div>
    </div>
  );
}

function formatKm(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

function formatEUR(amount: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(amount);
}
