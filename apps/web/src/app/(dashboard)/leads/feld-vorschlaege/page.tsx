"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Suggestion {
  id: string;
  dealRecordId: string;
  dealName: string;
  fieldLabel: string;
  proposedLabel: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
}

export default function FeldVorschlaegePage() {
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/deals/enrichment-suggestions?status=pending");
    if (!res.ok) {
      setRows([]);
      return;
    }
    const json = await res.json();
    setRows(Array.isArray(json.data) ? json.data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: Suggestion, action: "accept" | "reject") {
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/deals/${row.dealRecordId}/enrichment-suggestions/${row.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message || "Konnte den Vorschlag nicht speichern");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-violet-500" />
        <h1 className="text-xl font-semibold">Offene KI-Vorschläge</h1>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Felder, die das Gespräch nahelegt, aber noch nicht sicher genug fürs automatische Setzen sind.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine offenen Vorschläge.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/objects/deals/${row.dealRecordId}`} className="font-medium hover:underline">
                  {row.dealName}
                </Link>
                <span className="text-xs text-muted-foreground">{Math.round(row.confidence * 100)}% · KI</span>
              </div>
              <div>
                {row.fieldLabel} → {row.proposedLabel}
              </div>
              <p className="text-xs text-muted-foreground">{row.reason}</p>
              <p className="text-xs italic text-muted-foreground">„{row.evidenceQuote}“</p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" disabled={busy === row.id} onClick={() => decide(row, "accept")}>
                  Übernehmen
                </Button>
                <Button size="sm" variant="outline" disabled={busy === row.id} onClick={() => decide(row, "reject")}>
                  Ablehnen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
