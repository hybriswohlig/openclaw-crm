"use client";

/**
 * Lagekarte: lädt GET /api/v1/lagekarte. Polling alle 60 s, solange der Tab
 * sichtbar ist (visibilitychange pausiert); bei Rückkehr sofort neu. Fehler
 * behalten die letzten Daten (Banner im HUD statt leerer Karte).
 *
 * Vorschau (vorschau.ts, nur Entwicklung mit demo=1): beispielAntwort() aus dem
 * dynamisch geladenen Beispielmodul, kein Abruf, kein Polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LagekarteAntwort } from "@/lib/lagekarte/typen";
import { ladeBeispielDaten } from "./vorschau";

const POLL_MS = 60_000;

async function holeLage(signal: AbortSignal): Promise<LagekarteAntwort> {
  let res: Response;
  try {
    res = await fetch("/api/v1/lagekarte", { cache: "no-store", signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error("Keine Verbindung zum Server");
  }
  if (!res.ok) {
    let meldung = `Lage konnte nicht geladen werden (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } | string };
      if (typeof body.error === "string") meldung = body.error;
      else if (typeof body.error?.message === "string") meldung = body.error.message;
    } catch {
      /* Antwort ohne JSON */
    }
    throw new Error(meldung);
  }
  const body = (await res.json()) as { data?: LagekarteAntwort };
  if (!body.data || !Array.isArray(body.data.leads)) throw new Error("Unerwartete Antwort vom Server");
  return body.data;
}

export function useLagekarteDaten(vorschau = false): {
  daten: LagekarteAntwort | null;
  laedt: boolean;
  fehler: string | null;
  neuLaden: () => Promise<void>;
  letzterErfolg: Date | null;
} {
  const [daten, setDaten] = useState<LagekarteAntwort | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [letzterErfolg, setLetzterErfolg] = useState<Date | null>(null);

  const laufend = useRef<{ ctrl: AbortController; versprechen: Promise<void> } | null>(null);
  const aktiv = useRef(true);

  /**
   * Ein Abruf zur Zeit. Polling hängt sich an einen laufenden Abruf an;
   * `erzwingen` (z. B. nach einer Stufenänderung) bricht ihn ab und lädt frisch,
   * damit keine Antwort von vor der Änderung das Ergebnis überschreibt.
   */
  const laden = useCallback((erzwingen: boolean): Promise<void> => {
    if (vorschau) return Promise.resolve();
    if (laufend.current) {
      if (!erzwingen) return laufend.current.versprechen;
      laufend.current.ctrl.abort();
    }
    const ctrl = new AbortController();
    setLaedt(true);
    const versprechen = holeLage(ctrl.signal)
      .then((neu) => {
        if (!aktiv.current || ctrl.signal.aborted) return;
        setDaten(neu);
        setFehler(null);
        setLetzterErfolg(new Date());
      })
      .catch((err: unknown) => {
        if (!aktiv.current || ctrl.signal.aborted) return;
        setFehler(err instanceof Error ? err.message : "Lage konnte nicht geladen werden");
      })
      .finally(() => {
        if (laufend.current?.ctrl === ctrl) {
          laufend.current = null;
          if (aktiv.current) setLaedt(false);
        }
      });
    laufend.current = { ctrl, versprechen };
    return versprechen;
  }, [vorschau]);

  const neuLaden = useCallback(() => laden(true), [laden]);

  useEffect(() => {
    aktiv.current = true;
    if (vorschau) {
      // Beispieldaten (Modul nur außerhalb von Produktion), kein Abruf, kein Polling.
      let abgebrochen = false;
      void ladeBeispielDaten().then((beispiel) => {
        if (abgebrochen || !beispiel) return;
        const jetzt = new Date();
        setDaten(beispiel.beispielAntwort(jetzt));
        setLetzterErfolg(jetzt);
        setLaedt(false);
      });
      return () => {
        abgebrochen = true;
      };
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const sichtbar = () => typeof document === "undefined" || document.visibilityState === "visible";

    const starteTakt = () => {
      if (timer === null) timer = setInterval(() => void laden(false), POLL_MS);
    };
    const stoppeTakt = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    void laden(false);
    if (sichtbar()) starteTakt();

    const beiSichtwechsel = () => {
      if (sichtbar()) {
        void laden(false);
        starteTakt();
      } else {
        stoppeTakt();
      }
    };
    document.addEventListener("visibilitychange", beiSichtwechsel);

    return () => {
      aktiv.current = false;
      stoppeTakt();
      document.removeEventListener("visibilitychange", beiSichtwechsel);
      laufend.current?.ctrl.abort();
      laufend.current = null;
    };
  }, [laden, vorschau]);

  return { daten, laedt, fehler, neuLaden, letzterErfolg };
}
