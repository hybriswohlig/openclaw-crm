"use client";

import "@/styles/neu-einstellungen.css";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf } from "@/components/neu/akte/api";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { EinstellungenAntwort } from "@/lib/einstellungen-uebersicht";
import { firmaKurz } from "./einstellungen-logik";
import { FirmaKarte } from "./firma-karte";
import { FuerMich } from "./fuer-mich";
import { RechnerAbschnitt } from "./rechner-abschnitt";
import { SchluesselListe } from "./schluessel-liste";
import { ALTE_SEITEN, TEXT } from "./texte";

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; antwort: EinstellungenAntwort };

/** Firma aus dem Anker `#firma-<id>`, sonst die erste. */
function firmaAusAnker(antwort: EinstellungenAntwort): string | null {
  const ids = antwort.firmen?.map((f) => f.id) ?? [];
  const anker = typeof window === "undefined" ? "" : window.location.hash.replace(/^#firma-/, "");
  return ids.includes(anker) ? anker : (ids[0] ?? null);
}

/**
 * /app/einstellungen (Plan 13, Entscheidungen 3 bis 11): „Für mich“,
 * „Firmen“ (Segment, eine Karte je Firma), „Rechner“ (nur lesen), „Zugänge“
 * (nur lesen), unten die alten Seiten. Ohne Admin-Rolle nur „Für mich“.
 * Geschrieben wird über die vorhandenen Routen; nach jedem Speichern lädt die
 * Seite `GET /api/v1/einstellungen` neu.
 */
export function EinstellungenSeite({ rechnerUrl }: { rechnerUrl: string | null }) {
  const portalZiel = usePortalZiel();
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [firma, setFirma] = useState<string | null>(null);
  const lauf = useRef(0);

  const laden = useCallback(async (still = false) => {
    const dieser = ++lauf.current;
    if (!still) setZustand({ art: "laden" });
    const r = await apiAufruf<EinstellungenAntwort>("/api/v1/einstellungen");
    if (dieser !== lauf.current) return;
    if (r.ok) {
      setZustand({ art: "fertig", antwort: r.data });
      setFirma((f) => (f && r.data.firmen?.some((x) => x.id === f) ? f : firmaAusAnker(r.data)));
    } else if (still) toast.error("Einstellungen konnten nicht neu geladen werden.", { description: r.message });
    else setZustand({ art: "fehler", meldung: r.message });
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const neuLaden = useCallback(() => laden(true), [laden]);
  const a = zustand.art === "fertig" ? zustand.antwort : null;
  const firmen = a?.firmen ?? [];
  const gewaehlt = firmen.find((f) => f.id === firma) ?? firmen[0] ?? null;

  return (
    <div className="einst">
      <header className="neu-kopf">
        <h1>{TEXT.titel}</h1>
        <p className="neu-kopf-zweite">{a && !a.admin ? TEXT.zweiteMember : TEXT.zweite}</p>
      </header>

      {zustand.art === "laden" ? (
        <div className="einst-ich" aria-busy="true" aria-label={TEXT.laden}>
          <span className="lg-skeleton einst-skelett" />
          <span className="lg-skeleton einst-skelett" />
        </div>
      ) : null}

      {zustand.art === "fehler" ? (
        <div className="einst-hinweis" role="alert">
          <p>
            {TEXT.ladeFehler} {zustand.meldung}
          </p>
          <GlassButton size="sm" onClick={() => void laden()}>
            {TEXT.erneut}
          </GlassButton>
        </div>
      ) : null}

      {a ? (
        <>
          <FuerMich ich={a.ich} firmen={firmen.map((f) => ({ id: f.id, name: f.name }))} portalZiel={portalZiel} onGespeichert={neuLaden} />

          {a.admin && gewaehlt ? (
            <section className="einst-bereich" aria-labelledby="einst-firmen">
              <div className="einst-bereich-kopf einst-bereich-kopf-zeile">
                <h2 className="einst-bereich-titel" id="einst-firmen">
                  {TEXT.abschnittFirmen}
                </h2>
                {firmen.length > 1 ? (
                  <div className="einst-firmenwahl">
                    <GlassSegmentedControl
                      value={gewaehlt.id}
                      onValueChange={(v) => {
                        setFirma(v);
                        try {
                          window.history.replaceState(null, "", `#firma-${v}`);
                        } catch {
                          /* Anker ist Komfort */
                        }
                      }}
                      aria-label="Firma"
                    >
                      {firmen.map((f) => (
                        <GlassSegmentedControlItem key={f.id} value={f.id}>
                          {firmaKurz(f.name)}
                        </GlassSegmentedControlItem>
                      ))}
                    </GlassSegmentedControl>
                  </div>
                ) : null}
              </div>
              <FirmaKarte key={gewaehlt.id} firma={gewaehlt} portalZiel={portalZiel} onGespeichert={neuLaden} />
            </section>
          ) : null}

          {a.admin ? <RechnerAbschnitt firmen={firmen} rechnerUrl={rechnerUrl} /> : null}
          {a.admin && a.apiSchluessel ? <SchluesselListe schluessel={a.apiSchluessel} jetzt={new Date()} /> : null}

          {a.admin ? (
            <aside className="einst-alt" aria-labelledby="einst-alt">
              <h2 id="einst-alt">{TEXT.alt}</h2>
              <ul>
                {ALTE_SEITEN.map((s) => (
                  <li key={s.href}>
                    <Link href={s.href}>{s.label}</Link>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
