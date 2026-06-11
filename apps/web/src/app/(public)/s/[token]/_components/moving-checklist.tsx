"use client";

import { useEffect, useState } from "react";

/**
 * Stage-2 preparation checklist for the waiting weeks before the move.
 * Ticks live only in the customer's browser: localStorage under
 * `kottke.portal.checklist.{token}` as a JSON array of checked indices.
 * Storage access is wrapped in try/catch (same as use-visit-tracker.ts) so
 * Private Mode never breaks the page.
 */

const ITEMS: { label: string; detail: string | null }[] = [
  { label: "Kartons beschriften", detail: "Zielraum draufschreiben" },
  {
    label: "Halteverbotszone beantragen",
    detail: "Falls nötig, 7 bis 10 Tage Vorlauf",
  },
  { label: "Parkplatz für den Transporter freihalten", detail: null },
  { label: "Aufzug reservieren", detail: "Falls vorhanden" },
  { label: "Nachsendeauftrag stellen", detail: null },
  { label: "Zählerstände ablesen und fotografieren", detail: null },
  { label: "Wertsachen und Dokumente separat transportieren", detail: null },
  { label: "Kühlschrank 24 Stunden vorher abtauen", detail: null },
];

export function MovingChecklist({ token }: { token: string }) {
  const storageKey = `kottke.portal.checklist.${token}`;
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setChecked(
        new Set(
          parsed.filter(
            (n): n is number =>
              typeof n === "number" &&
              Number.isInteger(n) &&
              n >= 0 &&
              n < ITEMS.length
          )
        )
      );
    } catch {
      // Private mode / corrupt value: start with nothing ticked.
    }
  }, [storageKey]);

  function toggle(index: number) {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setChecked(next);
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify([...next].sort((a, b) => a - b))
      );
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-6 py-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Gut vorbereitet in den Umzug
        </div>
        <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {checked.size} von {ITEMS.length} erledigt
        </div>
      </div>
      <ul className="divide-y divide-border/50">
        {ITEMS.map((item, index) => {
          const done = checked.has(index);
          return (
            <li key={item.label}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-6 py-3 transition-colors hover:bg-accent/50">
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => toggle(index)}
                  className="h-5 w-5 shrink-0 accent-foreground"
                />
                <span
                  className={
                    done ? "text-muted-foreground line-through opacity-70" : ""
                  }
                >
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  {item.detail && (
                    <span className="block text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
