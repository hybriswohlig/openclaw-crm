"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FieldSuggestion {
  kind: "field";
  id: string;
  dealRecordId: string;
  dealName: string;
  fieldLabel: string;
  proposedLabel: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
}

interface DealSuggestion {
  kind: "deal";
  id: string;
  conversationId: string;
  dealName: string;
  subject: string | null;
  fieldLabel: string;
  proposedLabel: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
}

type Row = FieldSuggestion | DealSuggestion;

export default function FeldVorschlaegePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [fieldsRes, dealsRes] = await Promise.all([
      fetch("/api/v1/deals/enrichment-suggestions?status=pending"),
      fetch("/api/v1/inbox/deal-suggestions?status=pending"),
    ]);
    const fieldsJson = fieldsRes.ok ? await fieldsRes.json() : { data: [] };
    const dealsJson = dealsRes.ok ? await dealsRes.json() : { data: [] };
    const fields: FieldSuggestion[] = (Array.isArray(fieldsJson.data) ? fieldsJson.data : []).map(
      (row: Omit<FieldSuggestion, "kind">) => ({ ...row, kind: "field" as const })
    );
    const deals: DealSuggestion[] = (Array.isArray(dealsJson.data) ? dealsJson.data : []).map(
      (row: Omit<DealSuggestion, "kind">) => ({ ...row, kind: "deal" as const })
    );
    setRows([...deals, ...fields]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: Row, action: "accept" | "reject") {
    setBusy(row.id);
    setError(null);
    try {
      const url =
        row.kind === "deal"
          ? `/api/v1/inbox/deal-suggestions/${row.id}`
          : `/api/v1/deals/${row.dealRecordId}/enrichment-suggestions/${row.id}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
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
        Unsichere Kundenanfragen erscheinen als „Deal anlegen“. Feldwerte, die das Gespräch
        nahelegt, aber noch nicht sicher genug sind, stehen darunter.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine offenen Vorschläge.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={`${row.kind}:${row.id}`} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {row.kind === "deal" ? (
                  <Link href={`/inbox?conv=${row.conversationId}`} className="font-medium hover:underline">
                    {row.dealName}
                    {row.subject ? ` · ${row.subject}` : ""}
                  </Link>
                ) : (
                  <Link href={`/objects/deals/${row.dealRecordId}`} className="font-medium hover:underline">
                    {row.dealName}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">{Math.round(row.confidence * 100)}% · KI</span>
              </div>
              <div>
                {row.fieldLabel} → {row.proposedLabel}
              </div>
              <p className="text-xs text-muted-foreground">{row.reason}</p>
              <p className="text-xs italic text-muted-foreground">„{row.evidenceQuote}“</p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" disabled={busy === row.id} onClick={() => decide(row, "accept")}>
                  {row.kind === "deal" ? "Deal anlegen" : "Übernehmen"}
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
