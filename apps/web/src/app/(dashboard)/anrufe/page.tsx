"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Phone } from "lucide-react";
import { callActivityTitle, matchStatusLabel } from "@/lib/phone-call-text";

interface Anruf {
  id: string;
  callerE164: string | null;
  callerRaw: string | null;
  lineLabel: string | null;
  startedAt: string;
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  keywords: string[];
  personRecordId: string | null;
  matchStatus: string;
}

export default function AnrufePage() {
  const [calls, setCalls] = useState<Anruf[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    let aktiv = true;
    async function laden() {
      setLoading(true);
      setFehler(false);
      try {
        const res = await fetch("/api/v1/phone-calls?limit=40");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (aktiv) setCalls(Array.isArray(data.data) ? data.data : []);
      } catch {
        if (aktiv) setFehler(true);
      } finally {
        if (aktiv) setLoading(false);
      }
    }
    laden();
    return () => {
      aktiv = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Phone className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Anrufe</h1>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Anrufe werden geladen.
        </div>
      )}

      {!loading && fehler && (
        <p className="text-sm text-muted-foreground">Anrufe konnten nicht geladen werden.</p>
      )}

      {!loading && !fehler && calls.length === 0 && (
        <p className="text-sm text-muted-foreground">Noch keine Anrufe.</p>
      )}

      {!loading && !fehler && calls.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {calls.map((call) => (
            <li key={call.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{callActivityTitle(call)}</p>
                <time className="text-xs text-muted-foreground" dateTime={call.startedAt}>
                  {new Date(call.startedAt).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className="mt-1 text-xs">
                {call.matchStatus === "matched" && call.personRecordId ? (
                  <Link
                    href={`/objects/people/${call.personRecordId}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Kunde öffnen
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{matchStatusLabel(call.matchStatus)}</span>
                )}
              </p>
              {call.summary && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{call.summary}</p>
              )}
              {call.keywords.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{call.keywords.join(" · ")}</p>
              )}
              {call.transcript && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Transkript</summary>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{call.transcript}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
