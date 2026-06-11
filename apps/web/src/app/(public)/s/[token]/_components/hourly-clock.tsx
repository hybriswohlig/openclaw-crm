"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import type {
  CrewMember,
  KvaSnapshot,
  MoveTiming,
} from "@openclaw-crm/customer-portal-core";

/**
 * Live hourly-billing transparency widget. Shows three milestones plus a
 * running clock derived from the variable line items in the KVA. We compute
 * cost client-side and tick once per minute while the crew is on-site, so
 * the total updates calmly instead of counting up like a taximeter.
 *
 * Numbers are illustrative ("voraussichtlich"); the final invoice is what
 * counts. Goal: build trust by showing the running total instead of leaving
 * the customer to guess.
 */
export function HourlyClock({
  timing,
  kva,
  crew,
  primaryColor,
}: {
  timing: MoveTiming;
  kva: KvaSnapshot | null;
  crew: CrewMember[];
  primaryColor: string;
}) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // Only re-tick while the move is actually running.
    if (timing.finishedAt || !timing.onsiteAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [timing.onsiteAt, timing.finishedAt]);

  const onsiteMs = timing.onsiteAt ? Date.parse(timing.onsiteAt) : null;
  const finishedMs = timing.finishedAt ? Date.parse(timing.finishedAt) : null;
  const endMs = finishedMs ?? (onsiteMs ? now : null);
  const elapsedSec = onsiteMs && endMs ? Math.max(0, Math.floor((endMs - onsiteMs) / 1000)) : 0;

  // Hourly rate model: pull rates from the variable line items in the KVA.
  // Helpers count = offered quantity from the KVA so the customer sees the
  // rates they accepted; crew size on-site is only the fallback.
  const helperRate = kva?.lineItems.find((li) => li.type === "helper")?.unitRate ?? 0;
  const transporterRate = kva?.lineItems.find((li) => li.type === "transporter")?.unitRate ?? 0;
  const offeredHelpers = kva?.lineItems.find((li) => li.type === "helper")?.quantity ?? 0;
  const helperCount =
    offeredHelpers > 0
      ? offeredHelpers
      : crew.filter((c) => c.role !== "Transporter").length || crew.length;
  const hourlyRunRateEur = helperCount * helperRate + transporterRate;
  const elapsedHours = elapsedSec / 3600;
  const runningEur = elapsedHours * hourlyRunRateEur;

  const elapsedLabel = formatElapsed(elapsedSec);
  const runningLabel = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(runningEur);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div
        className="px-6 py-3 text-sm font-medium text-white"
        style={{ background: `#${primaryColor}` }}
      >
        <span className="inline-flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Live-Abrechnung (voraussichtlich)
        </span>
      </div>
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Milestone label="Anfahrt" iso={timing.departureAt} />
          <Milestone label="Vor Ort" iso={timing.onsiteAt} />
          <Milestone label="Beendet" iso={timing.finishedAt} />
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Bisherige Dauer
            </div>
            <div className="text-lg font-medium tabular-nums">{elapsedLabel}</div>
          </div>
          {hourlyRunRateEur > 0 && (
            <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {helperCount} Helfer × {formatEur(helperRate)} +{" "}
                {formatEur(transporterRate)} Transporter
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {runningLabel}
              </span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Diese Berechnung dient der Transparenz während des Auftrags. Verbindlich
          ist die finale Rechnung.
        </p>
      </div>
    </section>
  );
}

function Milestone({ label, iso }: { label: string; iso: string | null }) {
  return (
    <div className="space-y-1 rounded-lg border border-border/50 px-2 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs tabular-nums">
        {iso
          ? new Date(iso).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "·"}
      </div>
    </div>
  );
}

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function formatEur(v: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(v);
}
