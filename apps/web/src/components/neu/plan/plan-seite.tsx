"use client";

import "@/styles/neu-plan.css";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { berlinDateString } from "@/lib/berlin-date";
import {
  PLAN_ANSICHT_SCHLUESSEL,
  planAnsichtAus,
  planZustandAusParams,
  planZustandZuParams,
  type PlanAnsicht as GespeicherteAnsicht,
  type PlanSeitenZustand,
} from "@/lib/plan-heute";
import { PlanAnsicht } from "./plan-ansicht";
import { PlanKopf } from "./plan-kopf";
import { ansichtSpeicherer, planSeitenUrl } from "./plan-logik";

/**
 * /app/plan (Plan 8, Entscheidung 4): hält den Zustand in der URL
 * (`ansicht`, `tag`, `firma`, `ma`; die URL geht vor der gespeicherten
 * Ansicht), liest die gespeicherte Ansicht (`user_settings.ansichten.plan`)
 * und speichert den Modus 500 ms nach der letzten Änderung. Zurück und Vor
 * lesen die URL wieder. Der Inhalt ist `PlanAnsicht`.
 */
export function PlanSeite() {
  const params = useSearchParams();
  const [zustand, setZustand] = useState<PlanSeitenZustand | null>(null);
  const speicherer = useRef<ReturnType<typeof ansichtSpeicherer> | null>(null);

  useEffect(() => {
    const s = ansichtSpeicherer(
      (a: GespeicherteAnsicht) => {
        void apiAufruf<unknown>(`/api/v1/me/ansichten/${PLAN_ANSICHT_SCHLUESSEL}`, jsonAufruf("PUT", a)).then((r) => {
          if (!r.ok) toast.message("Ansicht nicht gespeichert.", { description: r.message });
        });
      },
      { setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (id) => window.clearTimeout(id as number) }
    );
    speicherer.current = s;
    let aktiv = true;
    void apiAufruf<{ ansichten?: Record<string, unknown> }>("/api/v1/me/settings").then((r) => {
      if (!aktiv) return;
      const gespeichert = planAnsichtAus(r.ok ? r.data?.ansichten?.[PLAN_ANSICHT_SCHLUESSEL] : undefined);
      const anfang = planZustandAusParams(new URLSearchParams(params.toString()), berlinDateString(), gespeichert);
      // Ein Link mit `ansicht=` (etwa aus „Heute“) ändert die gespeicherte Ansicht nicht; erst ein eigener Wechsel.
      s.geladen({ modus: anfang.modus });
      setZustand(anfang);
    });
    return () => {
      aktiv = false;
      s.abbrechen();
    };
    // Nur beim Öffnen: danach führt die Seite den Zustand selbst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL nachführen, ohne Server-Rundweg; den Modus verzögert speichern.
  useEffect(() => {
    if (!zustand) return;
    const url = planSeitenUrl(planZustandZuParams(zustand));
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
    speicherer.current?.planen({ modus: zustand.modus });
  }, [zustand]);

  // Zurück und Vor (etwa aus „Heute“ in den Tag) lesen den Zustand wieder aus der URL.
  useEffect(() => {
    const lesen = () =>
      setZustand((alt) => (alt ? planZustandAusParams(new URLSearchParams(window.location.search), berlinDateString(), { modus: alt.modus }) : alt));
    window.addEventListener("popstate", lesen);
    return () => window.removeEventListener("popstate", lesen);
  }, []);

  const setzen = useCallback((z: PlanSeitenZustand) => setZustand(z), []);

  if (!zustand) {
    return (
      <div className="plan" aria-busy="true" aria-label="Plan wird geladen">
        <PlanKopf kompakt={false} />
        <span className="lg-skeleton plan-skelett-leiste" />
        <span className="lg-skeleton plan-skelett-flaeche" />
      </div>
    );
  }
  return <PlanAnsicht zustand={zustand} onZustand={setzen} leads={null} />;
}
