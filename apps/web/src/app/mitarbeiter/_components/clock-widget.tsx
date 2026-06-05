"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Coffee, Loader2, Clock } from "lucide-react";

interface OpenEntry {
  id: string;
  startAt: string;
  breakMinutes: number;
  dealRecordId: string | null;
  status?: string;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export default function ClockWidget({ dealRecordId }: { dealRecordId: string }) {
  const [open, setOpen] = useState<OpenEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/portal/time-entries", { cache: "no-store" });
      if (!res.ok) throw new Error("Zeiterfassung konnte nicht geladen werden.");
      const json = await res.json();
      const entry: OpenEntry | null = json.data ?? null;
      setOpen(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isMine = open != null && open.dealRecordId === dealRecordId;

  useEffect(() => {
    if (isMine) {
      setNow(Date.now());
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
      };
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, [isMine, open?.id]);

  async function clockIn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/portal/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealRecordId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Einstempeln nicht möglich.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Einstempeln nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/portal/time-entries/${open.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Aktion nicht möglich.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion nicht möglich.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-base">Zeiterfassung wird geladen</span>
        </div>
      </section>
    );
  }

  // Another job is already running.
  const otherRunning = open != null && !isMine;

  if (isMine && open) {
    const startMs = new Date(open.startAt).getTime();
    const elapsed = (now - startMs) / 1000;
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Zeiterfassung läuft</h2>
        </div>
        <p className="mb-1 text-center font-mono text-4xl font-bold tabular-nums">
          {formatDuration(elapsed)}
        </p>
        <p className="mb-4 text-center text-sm text-muted-foreground">
          Start {new Date(open.startAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
          {open.breakMinutes > 0 ? ` · Pause ${open.breakMinutes} Min` : ""}
        </p>
        {error && (
          <p className="mb-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}
        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ addBreakMinutes: 15 })}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-base font-medium text-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Coffee className="h-5 w-5" aria-hidden="true" />}
            <span>Pause +15 Min</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ action: "stop" })}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Square className="h-5 w-5" aria-hidden="true" />}
            <span>Ausstempeln</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Zeiterfassung</h2>
      </div>
      {otherRunning && (
        <p className="mb-3 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          Du hast bereits eine laufende Zeiterfassung in einem anderen Auftrag. Stempel dort zuerst aus.
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      )}
      <button
        type="button"
        disabled={busy || otherRunning}
        onClick={clockIn}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
        <span>Einstempeln</span>
      </button>
    </section>
  );
}
