"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SpeedRow {
  id: string;
  name: string;
  sourceChannel: string | null;
  sourceDetail: string | null;
  receivedAt: string | null;
  createdAt: string;
  ageMs: number;
  sla: "green" | "yellow" | "red";
  conversationId: string | null;
  companyName: string | null;
}

interface SpeedResponse {
  records: SpeedRow[];
  sources: { id: string; title: string }[];
}

const SLA_LABEL = {
  green: "< 1 Std.",
  yellow: "< 24 Std.",
  red: "> 24 Std.",
} as const;

const SLA_CLASS = {
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
} as const;

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} Std.`;
  return `${Math.floor(hours / 24)} Tage`;
}

export default function SpeedToLeadPage() {
  const [rows, setRows] = useState<SpeedRow[]>([]);
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [source, setSource] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (source) params.set("source", source);
      if (company) params.set("company", company);
      const query = params.toString();
      const res = await fetch(`/api/v1/deals/speed-to-lead${query ? `?${query}` : ""}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { data?: SpeedResponse };
        setRows(json.data?.records ?? []);
        setSources(json.data?.sources ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [source, company]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Speed-to-Lead</h1>
          <p className="text-xs text-muted-foreground">
            Offene Leads ohne ausgehende Antwort, älteste zuerst. Grün unter 1 Stunde, gelb unter 24 Stunden, rot älter.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Quelle"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Alle Quellen</option>
            <option value="none">Ohne Quelle</option>
            {sources.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Firma"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          >
            <option value="">Alle Firmen</option>
            <option value="kottke">Kottke</option>
            <option value="ceylan">Ceylan</option>
          </select>
          <Button variant="ghost" size="icon" onClick={() => void fetchRows()} disabled={loading} aria-label="Aktualisieren">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Lädt…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Keine offenen Leads ohne Antwort.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">SLA</th>
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Quelle</th>
                <th className="px-4 py-2 font-medium">Anzeige</th>
                <th className="px-4 py-2 font-medium">Firma</th>
                <th className="px-4 py-2 font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-4 py-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", SLA_CLASS[row.sla])}>
                      {SLA_LABEL[row.sla]} · {formatAge(row.ageMs)}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{row.name}</td>
                  <td className="px-4 py-2">{row.sourceChannel ?? "Ohne Quelle"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{row.sourceDetail ?? "—"}</td>
                  <td className="px-4 py-2">{row.companyName ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-3">
                      <Link className="text-primary underline-offset-2 hover:underline" href={`/objects/deals/${row.id}`}>
                        Deal
                      </Link>
                      {row.conversationId ? (
                        <Link
                          className="text-primary underline-offset-2 hover:underline"
                          href={`/inbox?conv=${row.conversationId}`}
                        >
                          Gespräch
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
