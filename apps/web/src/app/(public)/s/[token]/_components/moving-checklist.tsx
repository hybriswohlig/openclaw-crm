"use client";

import { useEffect, useState } from "react";
import type { PortalMessageKey } from "@openclaw-crm/customer-portal-core";
import { useT } from "./portal-i18n";

/**
 * Stage-2 preparation checklist for the waiting weeks before the move.
 * Ticks live only in the customer's browser: localStorage under
 * `kottke.portal.checklist.{token}` as a JSON array of checked indices.
 * Storage access is wrapped in try/catch (same as use-visit-tracker.ts) so
 * Private Mode never breaks the page.
 */

// Message keys, not text: the stored tick indices must keep pointing at the
// same item whatever language the customer switches to.
const ITEMS: { labelKey: PortalMessageKey; detailKey: PortalMessageKey | null }[] = [
  { labelKey: "checklist.item1", detailKey: "checklist.item1Detail" },
  { labelKey: "checklist.item2", detailKey: "checklist.item2Detail" },
  { labelKey: "checklist.item3", detailKey: null },
  { labelKey: "checklist.item4", detailKey: "checklist.item4Detail" },
  { labelKey: "checklist.item5", detailKey: null },
  { labelKey: "checklist.item6", detailKey: null },
  { labelKey: "checklist.item7", detailKey: null },
  { labelKey: "checklist.item8", detailKey: null },
];

export function MovingChecklist({ token }: { token: string }) {
  const t = useT();
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
          {t("checklist.title")}
        </div>
        <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t("checklist.progress", {
            done: checked.size,
            total: ITEMS.length,
          })}
        </div>
      </div>
      <ul className="divide-y divide-border/50">
        {ITEMS.map((item, index) => {
          const done = checked.has(index);
          return (
            <li key={item.labelKey}>
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
                    {t(item.labelKey)}
                  </span>
                  {item.detailKey && (
                    <span className="block text-xs text-muted-foreground">
                      {t(item.detailKey)}
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
