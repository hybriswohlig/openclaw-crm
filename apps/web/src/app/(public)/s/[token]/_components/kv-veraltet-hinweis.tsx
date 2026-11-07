"use client";

import { RefreshCw } from "lucide-react";
import { kvVeraltetText, kvVeraltetTitel } from "@openclaw-crm/customer-portal-core";

/**
 * Steht statt des Annahme-Knopfs, solange das KV-PDF nicht zur aktuellen
 * Version passt (annahmeKvSperre). Der Server lehnt dann mit KV_VERALTET ab.
 */
export function KvVeraltetHinweis({ firma, className }: { firma: string; className?: string }) {
  return (
    <div role="status" data-portal-hinweis="kv-veraltet" className={className ?? "rounded-lg bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground"}>
      <p className="flex items-center gap-2 font-medium text-foreground">
        <RefreshCw size={14} aria-hidden className="shrink-0" />
        {kvVeraltetTitel(firma)}
      </p>
      <p className="mt-1">{kvVeraltetText(firma)}</p>
    </div>
  );
}
