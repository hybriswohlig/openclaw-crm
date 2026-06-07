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
import {
  Loader2,
  RefreshCw,
  Truck,
  ChevronRight,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  GenerateDocumentDialog,
  type DealData,
  type DocumentType,
  type PrefilledPreise,
} from "@/components/GenerateDocumentDialog";
import {
  AddressAutocomplete,
  type LocationValue,
} from "@/components/maps/AddressAutocomplete";

interface DriveLeg {
  fromLabel: string;
  toLabel: string;
  meters: number;
  seconds: number;
}

interface DepotOption {
  id: string;
  name: string;
  /** depot → pickup road distance in meters; null when unreachable. */
  distanceMeters: number | null;
  /** depot → pickup drive minutes; null when unreachable. */
  minutes: number | null;
  reachable: boolean;
}

interface EstimateResponse {
  depot: { id: string; name: string };
  /** Every active depot ranked nearest-first; drives the depot dropdown. */
  depotOptions: DepotOption[];
  /** The nearest reachable depot — marked "empfohlen" in the UI. */
  recommendedDepotId: string | null;
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
      depot?: { id?: string; name?: string };
      depotOptions?: DepotOption[];
      recommendedDepotId?: string | null;
    } | null;
  };
  /** When present, "In AB/RE übernehmen" buttons are enabled. */
  dealData: DealData | null;
  /**
   * Called after addresses are written back to the Lead (via inline form or
   * KI-Analyse) so the parent can re-fetch leadContext and rerun this card.
   */
  onLeadUpdated?: () => void;
}

type CeylanMode = "single" | "itemized";

interface MissingAddresses {
  from: boolean;
  to: boolean;
}

export function ZeitschaetzungSection({
  recordId,
  initial,
  dealData,
  onLeadUpdated,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingAddresses | null>(null);
  // Inline address-edit state when the "MISSING_ADDRESSES" fallback is open.
  const [editFrom, setEditFrom] = useState<LocationValue | null>(null);
  const [editTo, setEditTo] = useState<LocationValue | null>(null);
  const [savingAddrs, setSavingAddrs] = useState(false);
  const [kiBusy, setKiBusy] = useState(false);
  const [kiNote, setKiNote] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(() =>
    initial && initial.totalMinutes != null
      ? {
          depot: {
            id: initial.segments?.depot?.id ?? "",
            name: initial.depotName ?? initial.segments?.depot?.name ?? "—",
          },
          depotOptions: initial.segments?.depotOptions ?? [],
          recommendedDepotId: initial.segments?.recommendedDepotId ?? null,
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

  // ── Trip count: total number of pickup→dropoff loads. Default 1 = one
  // single haul. Higher when the volume needs multiple shuttle runs between
  // Abholung and Ziel before the final drop-off.
  const [tripCount, setTripCount] = useState(1);
  // ── Optional manual override for Be-/Entladezeit. When enabled the
  // computed estimate is ignored and the input value drives the total.
  const [manualLoadUnload, setManualLoadUnload] = useState(false);
  const [manualLoadUnloadMin, setManualLoadUnloadMin] = useState(60);

  const [dialogType, setDialogType] = useState<DocumentType | null>(null);

  // Re-seed sliders whenever a fresh estimate lands. Auto-derive starting
  // stunden from total minutes: round up to next half hour. When trip count
  // or load/unload override changes, re-seed too so the sliders stay in sync
  // with the headline total.
  useEffect(() => {
    if (!estimate || estimate.totalMinutes <= 0) return;
    const total = computeEffectiveTotal(
      estimate,
      tripCount,
      manualLoadUnload ? manualLoadUnloadMin : null
    );
    if (total <= 0) return;
    const hours = Math.max(mindestStunden, Math.ceil((total / 60) * 2) / 2);
    setStunden(hours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate?.computedAt, tripCount, manualLoadUnload, manualLoadUnloadMin]);

  async function recompute(depotRecordId?: string) {
    setBusy(true);
    setError(null);
    setWarning(null);
    setMissing(null);
    setKiNote(null);
    try {
      const resp = await fetch(`/api/v1/deals/${recordId}/auftrag/estimate-time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(depotRecordId ? { depotRecordId } : {}),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        // Special case: the Lead is missing addresses. Branch into an inline
        // fallback offering manual address entry + KI-Analyse instead of just
        // surfacing an error.
        if (
          json &&
          typeof json === "object" &&
          json.error?.code === "MISSING_ADDRESSES"
        ) {
          setMissing({
            from: !!json.missing?.from,
            to: !!json.missing?.to,
          });
          return;
        }
        setError(extractErrorMessage(json?.error) || `HTTP ${resp.status}`);
        return;
      }
      const raw = (json?.data ?? json) as Partial<EstimateResponse> | null;
      if (!raw || typeof raw !== "object") {
        setError("Unerwartete Server-Antwort (kein data-Objekt).");
        return;
      }
      // Coerce defensively — never let an undefined .legs/.warnings crash render.
      const data: EstimateResponse = {
        depot: raw.depot ?? { id: "", name: "—" },
        depotOptions: Array.isArray(raw.depotOptions) ? raw.depotOptions : [],
        recommendedDepotId:
          typeof raw.recommendedDepotId === "string" ? raw.recommendedDepotId : null,
        legs: Array.isArray(raw.legs) ? raw.legs : [],
        driveMinutesTotal: typeof raw.driveMinutesTotal === "number" ? raw.driveMinutesTotal : 0,
        loadUnloadMinutes: typeof raw.loadUnloadMinutes === "number" ? raw.loadUnloadMinutes : 0,
        totalMinutes: typeof raw.totalMinutes === "number" ? raw.totalMinutes : 0,
        computedAt: typeof raw.computedAt === "string" ? raw.computedAt : new Date().toISOString(),
        warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
        pickupAddress: typeof raw.pickupAddress === "string" ? raw.pickupAddress : "",
        dropoffAddress: typeof raw.dropoffAddress === "string" ? raw.dropoffAddress : "",
      };
      setEstimate(data);
      if (data.warnings.length > 0) setWarning(data.warnings.join(" · "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── Manual address-save (from the inline MISSING_ADDRESSES fallback) ──
  async function saveAddressesAndRetry() {
    if (!editFrom && !editTo) return;
    setSavingAddrs(true);
    setError(null);
    try {
      const values: Record<string, unknown> = {};
      if (editFrom) values.move_from_address = stripFormatted(editFrom);
      if (editTo) values.move_to_address = stripFormatted(editTo);
      const resp = await fetch(
        `/api/v1/objects/deals/records/${recordId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        }
      );
      if (!resp.ok) {
        const json = await resp.json().catch(() => null);
        setError(extractErrorMessage(json?.error) || `PATCH ${resp.status}`);
        return;
      }
      setMissing(null);
      setEditFrom(null);
      setEditTo(null);
      onLeadUpdated?.();
      // Auto-retry the estimate so the user lands directly on the result.
      await recompute();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingAddrs(false);
    }
  }

  // ── KI-Analyse trigger (reads chat + writes extracted addresses) ──────
  async function runKiAnalyse() {
    setKiBusy(true);
    setError(null);
    setKiNote("KI liest den Chatverlauf… (~30–60 s)");
    try {
      const resp = await fetch(`/api/v1/deals/${recordId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apply: true,
          // Only write back addresses; leave Auftrag/stage/notes alone so we
          // don't surprise the user with a bunch of other updates.
          selectedFields: ["move_from_address", "move_to_address"],
          applyStage: false,
          applyNote: false,
          applyContact: false,
          applyAuftrag: false,
        }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setKiNote(null);
        setError(extractErrorMessage(json?.error) || `KI HTTP ${resp.status}`);
        return;
      }
      setKiNote("KI fertig. Werte den Lead neu aus…");
      setMissing(null);
      onLeadUpdated?.();
      await recompute();
      setKiNote(null);
    } catch (e) {
      setKiNote(null);
      setError((e as Error).message);
    } finally {
      setKiBusy(false);
    }
  }

  // ── Pricing math (live) ──────────────────────────────────────────────
  const stundenAbrechnung = Math.max(stunden, mindestStunden);
  const stundensatzGesamt = helfer * helferRate + transporterRate;
  const baseTotal = stundenAbrechnung * stundensatzGesamt;
  const minderung = stammkundenrabatt ? baseTotal * 0.03 : 0;
  const totalEUR = Math.round((baseTotal - minderung) * 100) / 100;

  const isKottke = dealData?.firma === "kottke";

  // ── Effective drive / load+unload / total (reflect trip count + override) ──
  const effectiveDriveMinutes = useMemo(
    () => (estimate ? computeEffectiveDrive(estimate, tripCount) : 0),
    [estimate, tripCount]
  );
  const effectiveLoadUnloadMinutes = useMemo(() => {
    if (manualLoadUnload) return manualLoadUnloadMin;
    return estimate?.loadUnloadMinutes ?? 0;
  }, [estimate, manualLoadUnload, manualLoadUnloadMin]);
  const effectiveTotalMinutes = effectiveDriveMinutes + effectiveLoadUnloadMinutes;

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
          onClick={() => recompute()}
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
      {kiNote && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-2 text-xs text-blue-700">
          {kiNote}
        </div>
      )}

      {/* ── Inline fallback when the Lead is missing addresses ─────── */}
      {missing && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
          <div className="flex items-start gap-2 text-xs text-amber-800">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Adressen fehlen am Lead</div>
              <div className="text-amber-700/80">
                Trag sie unten ein (Google-Suche) oder lass die KI sie aus dem
                Chatverlauf extrahieren.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {missing.from && (
              <AddressAutocomplete
                label="Abholadresse"
                value={editFrom}
                onChange={setEditFrom}
                placeholder="Straße + Nr., PLZ Stadt"
                disabled={savingAddrs || kiBusy}
              />
            )}
            {missing.to && (
              <AddressAutocomplete
                label="Zieladresse"
                value={editTo}
                onChange={setEditTo}
                placeholder="Straße + Nr., PLZ Stadt"
                disabled={savingAddrs || kiBusy}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={saveAddressesAndRetry}
              disabled={
                savingAddrs ||
                kiBusy ||
                (missing.from && !editFrom) ||
                (missing.to && !editTo)
              }
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingAddrs ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <MapPin className="h-3 w-3" />
              )}
              Speichern & berechnen
            </button>
            <button
              type="button"
              onClick={runKiAnalyse}
              disabled={savingAddrs || kiBusy}
              className="inline-flex items-center gap-1 rounded border bg-white px-3 py-1.5 text-xs hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {kiBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              KI-Analyse aus Chat starten
            </button>
            <button
              type="button"
              onClick={() => setMissing(null)}
              disabled={savingAddrs || kiBusy}
              className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
            >
              abbrechen
            </button>
          </div>
        </div>
      )}

      {!estimate && !missing && (
        <p className="text-xs text-muted-foreground">
          Adressen werden live vom Lead gezogen. Klick auf <strong>Berechnen</strong>, um die Route
          (Depot → Abholung → Ziel → Depot) und die Be-/Entladezeit zu schätzen.
        </p>
      )}

      {estimate && (
        <>
          {/* ── Depot picker (nearest Sixt center, switchable) ─────── */}
          <DepotPicker
            options={estimate.depotOptions}
            chosenId={estimate.depot.id}
            chosenName={estimate.depot.name}
            recommendedId={estimate.recommendedDepotId}
            busy={busy}
            onPick={(id) => recompute(id)}
          />

          {/* ── Route legs ────────────────────────────────── */}
          <div className="rounded-md bg-background p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Route über {estimate.depot.name}
            </div>
            <ol className="space-y-1">
              {estimate.legs.map((leg, i) => {
                const meters = typeof leg?.meters === "number" ? leg.meters : 0;
                const seconds = typeof leg?.seconds === "number" ? leg.seconds : 0;
                return (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground tabular-nums w-6">{i + 1}.</span>
                    <span className="truncate flex-1">
                      {leg?.fromLabel ?? "—"} <ChevronRight className="inline h-3 w-3" /> {leg?.toLabel ?? "—"}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatKm(meters)} · {formatMinutes(Math.round(seconds / 60))}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 text-xs">
              <Stat
                label={tripCount > 1 ? `Fahrtzeit (${tripCount} Fahrten)` : "Fahrtzeit"}
                value={formatMinutes(effectiveDriveMinutes)}
              />
              <Stat
                label={manualLoadUnload ? "Be-/Entladen (manuell)" : "Be-/Entladen"}
                value={formatMinutes(effectiveLoadUnloadMinutes)}
              />
              <Stat label="Gesamt" value={formatMinutes(effectiveTotalMinutes)} highlight />
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
            <Slider
              label="Anzahl der Fahrten (Pendel-Strecke)"
              value={tripCount}
              min={1}
              max={8}
              step={1}
              onChange={setTripCount}
              suffix={tripCount === 1 ? "Fahrt" : "Fahrten"}
            />
            <div className="rounded border border-border/60 p-2 space-y-1.5">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Be-/Entladezeit manuell setzen</span>
                <input
                  type="checkbox"
                  checked={manualLoadUnload}
                  onChange={(e) => setManualLoadUnload(e.target.checked)}
                />
              </label>
              {manualLoadUnload && (
                <Slider
                  label="Be-/Entladen"
                  value={manualLoadUnloadMin}
                  min={0}
                  max={480}
                  step={5}
                  onChange={setManualLoadUnloadMin}
                  suffix="min"
                />
              )}
            </div>
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

/**
 * Depot dropdown. Lists every active Sixt center ranked nearest-first (drive
 * km + min to the Abholung), marks the closest as "empfohlen", and recomputes
 * the route when the operator switches. Renders nothing if there are no ranked
 * options (e.g. a legacy estimate saved before depot ranking existed).
 */
function DepotPicker({
  options,
  chosenId,
  chosenName,
  recommendedId,
  busy,
  onPick,
}: {
  options: DepotOption[];
  chosenId: string;
  chosenName: string;
  recommendedId: string | null;
  busy: boolean;
  onPick: (id: string) => void;
}) {
  if (!options || options.length === 0) return null;

  const recommended = options.find((o) => o.id === recommendedId) ?? null;
  const showRecommendCta = !!recommended && !!chosenId && chosenId !== recommendedId;

  return (
    <div className="rounded-md border border-border/60 bg-background p-3 space-y-1.5">
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <MapPin className="h-3 w-3" /> Abfahrt-Depot (Sixt Center)
      </label>
      <select
        value={chosenId || ""}
        disabled={busy}
        onChange={(e) => {
          const id = e.target.value;
          if (id && id !== chosenId) onPick(id);
        }}
        className="w-full rounded border px-2 py-1.5 text-sm bg-background disabled:opacity-50"
      >
        {/* Keep the chosen depot selectable even if it isn't in the ranked
            list (unreachable, or a legacy pick). */}
        {chosenId && !options.some((o) => o.id === chosenId) && (
          <option value={chosenId}>{chosenName}</option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {depotOptionLabel(o, o.id === recommendedId)}
          </option>
        ))}
      </select>
      {showRecommendCta && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPick(recommended!.id)}
          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" /> Näheres Depot wählen: {recommended!.name}
          {recommended!.minutes != null ? ` (${formatMinutes(recommended!.minutes)})` : ""}
        </button>
      )}
    </div>
  );
}

function depotOptionLabel(o: DepotOption, isRecommended: boolean): string {
  const dist =
    o.distanceMeters != null && o.minutes != null
      ? ` · ${formatKm(o.distanceMeters)} · ${formatMinutes(o.minutes)}`
      : o.reachable
        ? ""
        : " · keine Route";
  return `${o.name}${dist}${isRecommended ? "  ★ empfohlen" : ""}`;
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
 * The CRM's error helpers return { error: { code, message } }. Pull a
 * displayable string out, regardless of whether the value is a string or
 * the standard error envelope. Never returns an object — React error #31
 * has a way of finding any unguarded path.
 */
/**
 * Drive minutes adjusted for multiple shuttle trips between Abholung and
 * Ziel. Assumes the route legs come back as [depot→pickup, pickup→dropoff,
 * dropoff→depot]. For N>1 trips: depot→pickup + N×(pickup→dropoff) +
 * (N-1)×(dropoff→pickup, approximated as the same minutes) + dropoff→depot.
 *
 * If the legs aren't in the expected 3-leg shape, falls back to the raw
 * driveMinutesTotal × tripCount as a coarse estimate.
 */
function computeEffectiveDrive(est: EstimateResponse, tripCount: number): number {
  const n = Math.max(1, Math.floor(tripCount));
  if (n === 1) return est.driveMinutesTotal;
  if (est.legs.length !== 3) {
    return Math.round(est.driveMinutesTotal * n);
  }
  const minutesFor = (i: number) =>
    typeof est.legs[i]?.seconds === "number" ? est.legs[i].seconds / 60 : 0;
  const first = minutesFor(0);
  const middle = minutesFor(1);
  const last = minutesFor(2);
  // pickup → dropoff happens N times, dropoff → pickup (N-1) times.
  return Math.round(first + last + (2 * n - 1) * middle);
}

function computeEffectiveTotal(
  est: EstimateResponse,
  tripCount: number,
  manualLoadUnload: number | null
): number {
  const drive = computeEffectiveDrive(est, tripCount);
  const load = manualLoadUnload != null ? manualLoadUnload : est.loadUnloadMinutes;
  return drive + load;
}

/**
 * Drop the `formattedAddress` field before PATCHing — it's a UI-only sugar
 * not in the Lead's LocationValue contract (line1, postcode, city, countryCode).
 */
function stripFormatted(v: LocationValue): Record<string, string | undefined> {
  return {
    line1: v.line1,
    postcode: v.postcode,
    city: v.city,
    countryCode: v.countryCode,
  };
}

function extractErrorMessage(e: unknown): string {
  if (e == null) return "";
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; error?: unknown };
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.code === "string") return o.code;
  }
  try {
    return String(e);
  } catch {
    return "Unbekannter Fehler";
  }
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
