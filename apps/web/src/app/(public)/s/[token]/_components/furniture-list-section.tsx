"use client";

import { Package } from "lucide-react";
import type { FurnitureListItem } from "@openclaw-crm/customer-portal-core";

/**
 * Customer-facing furniture / inventory list on the offer page.
 * Only items marked as coming with the move are included server-side.
 */
export function FurnitureListSection({
  items,
  primaryColor,
}: {
  items: FurnitureListItem[];
  primaryColor: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Package
          className="h-4 w-4 shrink-0"
          style={{ color: `#${primaryColor}` }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Möbelliste</p>
          <p className="text-xs text-muted-foreground">
            Diese Gegenstände sind im Angebot berücksichtigt
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ background: `#${primaryColor}` }}
        >
          {items.length}
        </span>
      </div>
      <ul className="divide-y">
        {items.map((item, i) => (
          <li
            key={`${item.name}-${i}`}
            className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{item.name}</span>
              {item.category && (
                <span className="ml-2 text-xs text-muted-foreground">{item.category}</span>
              )}
            </span>
            {item.quantity > 1 && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                ×{item.quantity}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
