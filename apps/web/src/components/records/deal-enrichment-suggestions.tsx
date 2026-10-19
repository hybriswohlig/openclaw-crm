"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Suggestion {
  id: string;
  fieldLabel: string;
  proposedLabel: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
}

export function DealEnrichmentSuggestions({
  dealRecordId,
  onApplied,
}: {
  dealRecordId: string;
  onApplied?: () => void;
}) {
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/deals/${dealRecordId}/enrichment-suggestions?status=pending`);
    if (!res.ok) return;
    const json = await res.json();
    setRows(Array.isArray(json.data) ? json.data : []);
  }, [dealRecordId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: "accept" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/enrichment-suggestions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message || "Konnte den Vorschlag nicht speichern");
        return;
      }
      if (action === "accept") onApplied?.();
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!rows || rows.length === 0) return null;

  return (
    <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-violet-500" />
        KI-Vorschläge
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="text-sm">
            <div className="font-medium">
              {row.fieldLabel} → {row.proposedLabel}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {Math.round(row.confidence * 100)}% · KI
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{row.reason}</p>
            <p className="mt-0.5 text-xs italic text-muted-foreground">„{row.evidenceQuote}“</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={busy === row.id} onClick={() => decide(row.id, "accept")}>
                {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Übernehmen"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === row.id}
                onClick={() => decide(row.id, "reject")}
              >
                Ablehnen
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
