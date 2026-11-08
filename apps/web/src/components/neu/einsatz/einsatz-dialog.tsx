"use client";

import "@/styles/neu-einsatz.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { tagKurz } from "@/lib/anzeige";
import type { DoppelKonflikt } from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import { anfahrtUebernehmen, EINSATZ_DIALOG_EVENT, einsatzLaden, teamBestaetigen } from "./einsatz-api";
import { EinsatzFahrzeug, type FahrzeugBuchung } from "./einsatz-fahrzeug";
import { EinsatzListe } from "./einsatz-liste";
import {
  auswahlEntfernen,
  auswahlHinzufuegen,
  geaendert,
  imTeam,
  leitungSetzen,
  minutenSetzen,
  rueckfrageFuer,
  startAuswahl,
  summeAus,
  teamBody,
  vorschlagUebernehmen,
  type Auswahl,
  type Rueckfrage,
} from "./einsatz-logik";
import { EinsatzSumme } from "./einsatz-summe";

export { einsatzDialogOeffnen } from "./einsatz-api";

/**
 * Hört auf `neu:einsatz-dialog-oeffnen` (Akte-Kopf „+“, Schritt 7) und zeigt den
 * Einsatz-Dialog für `dealId`. `onGespeichert` lädt die Akte neu.
 */
export function EinsatzDialogEmpfaenger({ dealId, onGespeichert }: { dealId: string; onGespeichert?: () => void | Promise<void> }) {
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    const bei = (e: Event) => {
      const d = (e as CustomEvent<{ dealId?: string }>).detail;
      if (d?.dealId === dealId) setOffen(true);
    };
    window.addEventListener(EINSATZ_DIALOG_EVENT, bei);
    return () => window.removeEventListener(EINSATZ_DIALOG_EVENT, bei);
  }, [dealId]);
  if (!offen) return null;
  return <EinsatzDialog dealId={dealId} onSchliessen={() => setOffen(false)} onGespeichert={onGespeichert} />;
}

type Laden = { art: "laedt" } | { art: "fehler"; meldung: string } | { art: "da"; ansicht: EinsatzAnsicht };

function tageText(tage: string[]): string | null {
  if (tage.length === 0) return null;
  return tage.length === 1 ? tagKurz(tage[0]!) : `${tagKurz(tage[0]!)} bis ${tagKurz(tage[tage.length - 1]!)}`;
}

/** Konflikte des Servers als Satz mit Namen, Tag und Auftrag. */
function konfliktText(k: DoppelKonflikt[], personen: EinsatzPersonLage[]): string {
  const teile = k.map((x) => {
    const name = personen.find((p) => p.id === x.employeeId)?.name ?? "Eine Person";
    const bei = x.andere.map((a) => a.titel).join(", ");
    return `${name} ist am ${tagKurz(x.tag)} schon bei ${bei} eingeteilt.`;
  });
  return [...new Set(teile)].join(" ");
}

export function EinsatzDialog({
  dealId,
  onSchliessen,
  onGespeichert,
  vorgabe,
}: {
  dealId: string;
  onSchliessen: () => void;
  onGespeichert?: () => void | Promise<void>;
  /** Für Sichtprüfung und Tests: Ansicht ohne Laden. */
  vorgabe?: EinsatzAnsicht;
}) {
  const portalZiel = usePortalZiel();
  const [laden, setLaden] = useState<Laden>(vorgabe ? { art: "da", ansicht: vorgabe } : { art: "laedt" });
  const [auswahl, setAuswahl] = useState<Auswahl | null>(vorgabe ? startAuswahl(vorgabe) : null);
  const [rueckfrage, setRueckfrage] = useState<Rueckfrage | { art: "konflikt"; text: string; ids: string[] } | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [aktualisiert, setAktualisiert] = useState(false);
  const [anfahrtLaeuft, setAnfahrtLaeuft] = useState(false);

  const holen = useCallback(
    async (frisch: boolean, auswahlBehalten: boolean) => {
      const r = await einsatzLaden(dealId, frisch);
      if (!r.ok) {
        if (!auswahlBehalten) setLaden({ art: "fehler", meldung: r.message });
        else toast.error("Einsatz konnte nicht neu geladen werden.", { description: r.message });
        return;
      }
      setLaden({ art: "da", ansicht: r.data });
      if (!auswahlBehalten) setAuswahl(startAuswahl(r.data));
    },
    [dealId],
  );

  useEffect(() => {
    if (!vorgabe) void holen(false, false);
  }, [holen, vorgabe]);

  const ansicht = laden.art === "da" ? laden.ansicht : null;
  const summe = useMemo(() => (ansicht && auswahl ? summeAus(auswahl, ansicht) : null), [ansicht, auswahl]);
  const namen = useMemo(() => Object.fromEntries((ansicht?.personen ?? []).map((p) => [p.id, p.name])), [ansicht]);
  const tagText = ansicht ? tageText(ansicht.tage) : null;

  if (!ansicht || !auswahl || !summe) {
    return (
      <GlassDialog open onOpenChange={(o) => !o && onSchliessen()}>
        <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="ez-dialog" data-laedt="">
          <GlassDialogTitle className="akte-dialog-titel">Einsatz planen</GlassDialogTitle>
          <GlassDialogDescription className="akte-dialog-text">
            {laden.art === "fehler" ? laden.meldung : "Einsatz wird geladen …"}
          </GlassDialogDescription>
          {laden.art === "laedt" ? (
            <div className="ez-skelett" aria-busy="true">
              <span className="lg-skeleton" />
              <span className="lg-skeleton" />
            </div>
          ) : (
            <div className="ez-fuss">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen}>
                Schließen
              </GlassButton>
            </div>
          )}
        </GlassDialogContent>
      </GlassDialog>
    );
  }

  const rechner = ansicht.rechner;
  const vorschlagIds = ansicht.teamVorschlag.team.map((t) => t.employeeId);

  function umschalten(p: EinsatzPersonLage) {
    if (!auswahl) return;
    if (imTeam(auswahl, p.id)) {
      if (p.stempeltGerade && ansicht?.team.some((t) => t.employeeId === p.id)) {
        toast.error(`${p.name} ist gerade für diesen Auftrag eingestempelt und kann nicht entfernt werden.`);
        return;
      }
      setAuswahl(auswahlEntfernen(auswahl, p.id, rechner));
      return;
    }
    const frage = rueckfrageFuer(p, tagText ?? "Umzugstag", auswahl);
    if (frage) {
      setRueckfrage(frage);
      return;
    }
    setAuswahl(auswahlHinzufuegen(auswahl, p.id, rechner));
  }

  async function bestaetigen(zusaetzlich: string[] = []) {
    if (!auswahl || !ansicht) return;
    const naechste = zusaetzlich.length > 0 ? { ...auswahl, bestaetigtAmTag: [...new Set([...auswahl.bestaetigtAmTag, ...zusaetzlich])] } : auswahl;
    setAuswahl(naechste);
    setSpeichert(true);
    const r = await teamBestaetigen(dealId, teamBody(naechste));
    setSpeichert(false);
    if (r.ok) {
      toast.success(
        r.team.length === 0
          ? "Team entfernt."
          : `Team bestätigt. In der App sichtbar für ${r.team.length} ${r.team.length === 1 ? "Person" : "Personen"}.`,
      );
      await onGespeichert?.();
      onSchliessen();
      return;
    }
    if (r.code === "DOPPELT_AM_TAG" && r.konflikte.length > 0) {
      setRueckfrage({
        art: "konflikt",
        text: `${konfliktText(r.konflikte, ansicht.personen)} Zwei Aufträge am Tag gehen nur bewusst. Trotzdem einteilen?`,
        ids: [...new Set(r.konflikte.map((k) => k.employeeId))],
      });
      return;
    }
    toast.error("Team konnte nicht bestätigt werden.", { description: r.message });
    if (r.code === "STEMPELT_NOCH" || r.code === "INAKTIV" || r.code === "UNBEKANNT") void holen(false, true);
  }

  async function anfahrtInKalkulation(euro: number) {
    if (!ansicht?.version) return;
    setAnfahrtLaeuft(true);
    const r = await anfahrtUebernehmen(dealId, ansicht.version.nummer, euro, "Anfahrt Team aus dem Einsatz (eigene PKW)");
    setAnfahrtLaeuft(false);
    if (!r.ok) {
      toast.error("Anfahrt konnte nicht übernommen werden.", { description: r.message });
      return;
    }
    toast.success(r.data.neu ? "In einen neuen Entwurf der Kalkulation übernommen." : "In die Kalkulation übernommen.", {
      description: "Der Preis ändert sich erst nach dem Neurechnen.",
    });
    await holen(false, true);
  }

  const buchungen: FahrzeugBuchung[] = [
    ...(ansicht.buchung ? [{ id: ansicht.buchung.id, text: ansicht.buchung.text, anteilCent: Math.ceil(ansicht.buchung.mieteCent / Math.max(1, ansicht.buchung.geplanteAuftraege)), zugeordnet: true }] : []),
    ...ansicht.buchungenAmTag
      .filter((b) => b.id !== ansicht.buchung?.id)
      .map((b) => ({ id: b.id, text: b.text, anteilCent: Math.ceil(b.mieteCent / Math.max(1, b.geplanteAuftraege)), zugeordnet: false })),
  ];
  const hinweise = [...ansicht.hinweise, ...ansicht.teamVorschlag.hinweise];
  const ungespeichert = geaendert(auswahl, ansicht);

  return (
    <GlassDialog open onOpenChange={(o) => !o && !speichert && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="ez-dialog" aria-describedby={undefined}>
        <header className="ez-kopf">
          <div className="ez-kopf-text">
            <GlassDialogTitle className="ez-titel">Einsatz planen</GlassDialogTitle>
            <p className="ez-unter">
              {[ansicht.titel, tagText ?? "noch kein Termin", ansicht.fest ? null : "Termin nicht fest"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="ez-kopf-chips">
            {ansicht.kapazitaet.map((k) => (
              <span key={k.tag} className="ez-chip" data-ton={k.ton} title={k.frei.map((p) => p.name).join(", ") || "niemand frei"}>
                <i aria-hidden="true" />
                {tagKurz(k.tag)}: {k.text}
              </span>
            ))}
            {/* Platz für den Umschalter „Liste | Karte“ (Plan 12c). */}
            <span className="ez-ansicht-platz" />
          </div>
        </header>

        {hinweise.length > 0 ? (
          <ul className="ez-hinweise">
            {hinweise.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}

        {rueckfrage ? (
          <div className="ez-rueckfrage" role="alertdialog" aria-labelledby="ez-rueckfrage-text">
            <i aria-hidden="true" />
            <p id="ez-rueckfrage-text">{rueckfrage.text}</p>
            <div className="ez-rueckfrage-knoepfe">
              <GlassButton type="button" size="sm" variant="ghost" onClick={() => setRueckfrage(null)}>
                Abbrechen
              </GlassButton>
              <GlassButton
                type="button"
                size="sm"
                autoFocus
                onClick={() => {
                  const f = rueckfrage;
                  setRueckfrage(null);
                  if (f.art === "konflikt") void bestaetigen(f.ids);
                  else setAuswahl(auswahlHinzufuegen(auswahl, f.person.id, rechner, { trotzdem: true }));
                }}
              >
                Trotzdem einteilen
              </GlassButton>
            </div>
          </div>
        ) : null}

        <div className="ez-spalten">
          <section className="ez-karte ez-liste-karte" aria-labelledby="ez-liste-titel">
            <div className="ez-karte-kopf ez-karte-kopf-zeile">
              <div>
                <h3 id="ez-liste-titel">{tagText ? `Mitarbeiter am ${tagText}` : "Mitarbeiter"}</h3>
                <p>
                  {ansicht.teamVorschlag.team.length > 0
                    ? `Vorschlag aus der Kalkulation: ${ansicht.teamVorschlag.team.length} ${ansicht.teamVorschlag.team.length === 1 ? "Person" : "Personen"}. Gold markiert, nur vorbelegt.`
                    : "Kein Vorschlag: Haken setzen."}
                </p>
              </div>
              <div className="ez-knoepfe-klein">
                {ansicht.teamVorschlag.team.length > 0 ? (
                  <button type="button" className="ez-link" onClick={() => setAuswahl(vorschlagUebernehmen(ansicht))}>
                    Vorschlag übernehmen
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ez-link"
                  disabled={aktualisiert}
                  aria-busy={aktualisiert || undefined}
                  onClick={async () => {
                    setAktualisiert(true);
                    await holen(true, true);
                    setAktualisiert(false);
                  }}
                >
                  {aktualisiert ? "Fahrzeiten werden geholt …" : "Fahrzeiten aktualisieren"}
                </button>
              </div>
            </div>
            <EinsatzListe
              personen={ansicht.personen}
              anfahrten={ansicht.anfahrten}
              team={auswahl.team}
              vorschlag={vorschlagIds}
              onUmschalten={umschalten}
              onMinuten={(id, teil, wert) => setAuswahl(minutenSetzen(auswahl, id, teil, wert, rechner))}
            />
            <p className="ez-notiz">
              Anfahrt mit Verkehr für 07:00 Uhr am Umzugstag; „ca.“ ist aus den Kilometern geschätzt. Gespeichert sind nur Kilometer je
              Ort, keine Straße.
            </p>
          </section>

          <aside className="ez-leiste">
            <EinsatzSumme
              team={auswahl.team}
              namen={namen}
              kosten={summe.kosten}
              vergleich={summe.vergleich}
              festpreisEur={rechner?.festpreisEur ?? null}
              anfahrtUebernommenEur={ansicht.anfahrtUebernommenEur}
              anfahrtLaeuft={anfahrtLaeuft}
              onEntfernen={(id) => {
                const p = ansicht.personen.find((x) => x.id === id);
                if (p) umschalten(p);
              }}
              onLeitung={(id) => setAuswahl(leitungSetzen(auswahl, id))}
              onAnfahrtUebernehmen={ansicht.version ? (e) => void anfahrtInKalkulation(e) : undefined}
            />
            <EinsatzFahrzeug
              tagText={tagText}
              fahrzeugName={rechner?.fahrzeugName ?? null}
              station={rechner?.station ?? null}
              fahrzeugEur={rechner?.fahrzeugEur ?? null}
              auslastung={ansicht.auslastung}
              buchungen={buchungen}
            />
          </aside>
        </div>

        <footer className="ez-fuss">
          <p>Erst danach sehen die Mitarbeiter den Auftrag in ihrer App.</p>
          <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={speichert}>
            Abbrechen
          </GlassButton>
          <GlassButton
            type="button"
            onClick={() => void bestaetigen()}
            disabled={speichert || (!ungespeichert && ansicht.team.length > 0 && ansicht.team.every((t) => t.confirmedAt))}
            aria-busy={speichert || undefined}
          >
            {speichert ? "Wird bestätigt …" : "Team bestätigen"}
          </GlassButton>
        </footer>
      </GlassDialogContent>
    </GlassDialog>
  );
}
