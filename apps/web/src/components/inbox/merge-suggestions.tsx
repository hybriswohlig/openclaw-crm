// One-click duplicate-merge review (KOT-IDENTITY Part B).
// Surfaces name-similarity suggestions (same human, no shared phone/email) so the
// operator confirms a merge with one click. Never merges silently.
"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Users, X, Loader2, GitMerge } from "lucide-react";

interface Suggestion {
  survivorId: string;
  survivorName: string;
  absorbedId: string;
  absorbedName: string;
  jw: number;
}

export function MergeSuggestions({ onMerged }: { onMerged: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/persons/merge-suggestions");
      if (res.ok) setItems(((await res.json()).data ?? []) as Suggestion[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (s: Suggestion, action: "merge" | "reject") => {
    setBusy(s.survivorId + s.absorbedId);
    try {
      const res = await fetch("/api/v1/persons/merge-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, idA: s.survivorId, idB: s.absorbedId }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((x) => !(x.survivorId === s.survivorId && x.absorbedId === s.absorbedId)));
        if (action === "merge") onMerged();
      }
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0 && !loading) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 w-full rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 transition-colors"
      >
        <Users className="h-3.5 w-3.5" />
        {items.length} mögliche {items.length === 1 ? "Dublette" : "Dubletten"}
        <span className="ml-auto text-amber-600">prüfen</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="font-semibold">Mögliche Dubletten</h2>
                <p className="text-xs text-muted-foreground">Gleicher Name, aber keine gemeinsame Nummer. Bitte bestätigen.</p>
              </div>
              <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
              {!loading && items.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Keine offenen Vorschläge.</p>}
              {items.map((s) => {
                const key = s.survivorId + s.absorbedId;
                return (
                  <div key={key} className="rounded-xl border border-border p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate">{s.survivorName}</span>
                      <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium truncate">{s.absorbedName}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">{Math.round(s.jw * 100)}%</span>
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        disabled={busy === key}
                        onClick={() => decide(s, "merge")}
                        className={cn("flex-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium py-1.5 hover:opacity-90", busy === key && "opacity-50")}
                      >
                        {busy === key ? "…" : "Zusammenführen"}
                      </button>
                      <button
                        disabled={busy === key}
                        onClick={() => decide(s, "reject")}
                        className="rounded-lg border border-border text-xs font-medium px-3 py-1.5 text-muted-foreground hover:text-foreground"
                      >
                        Verschieden
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
