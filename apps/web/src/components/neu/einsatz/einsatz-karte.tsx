"use client";

import "@/styles/neu-einsatz-karte.css";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { anfahrtText, pinGruppen, UMKREIS_KM, type EinsatzKarte, type KartenPerson, type PinGruppe, type UmkreisKm } from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import type { KartenSteuerung } from "./einsatz-karte-bild";
import {
  FILTER_VORGABE,
  kartenPersonenFiltern,
  umkreisLesen,
  umkreisMerken,
  versteckteAbwesende,
  type KartenFilter,
} from "./einsatz-karte-logik";
import { imTeam, type Auswahl, type Summe } from "./einsatz-logik";
import { EinsatzPin, LageSymbol, lageWort } from "./einsatz-pin";
import {
  HALTEN_MS,
  HALTEN_TOLERANZ_PX,
  kompaktText,
  trefferZiel,
  ziehenVorschau,
  ZIEHEN_AB_PX,
  type AblageZiel,
  type Bildpunkt,
} from "./einsatz-ziehen";

const EinsatzKarteBild = dynamic(() => import("./einsatz-karte-bild"), {
  ssr: false,
  loading: () => <span className="lg-skeleton ezk-bild-laden" />,
});

export type KarteLaden = { art: "laedt" } | { art: "fehler"; meldung: string } | { art: "da"; karte: EinsatzKarte };

/** Bei mehr Gruppen nur ein Hinweis (kein Clustering über Zoomstufen, Entscheidung 4). */
const GRUPPEN_HINWEIS_AB = 40;

function useSchmal(): boolean {
  const [schmal, setSchmal] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 640px)");
    const bei = () => setSchmal(m.matches);
    bei();
    m.addEventListener("change", bei);
    return () => m.removeEventListener("change", bei);
  }, []);
  return schmal;
}

function satzText(cent: number): string {
  const e = cent / 100;
  return `${e.toLocaleString("de-DE", { minimumFractionDigits: Number.isInteger(e) ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

type Offen = { art: "gruppe"; schluessel: string } | { art: "person"; id: string } | null;

interface Zug {
  k: KartenPerson;
  pointerId: number;
  touch: boolean;
  start: Bildpunkt;
  aktiv: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Karten-Ansicht im Einsatz-Dialog (Plan 12c, Task C). Teilt Auswahl,
 * Summenleiste und Fahrzeugkarte mit der Liste; schreibt nie. Ziehen eines
 * Pins auf Beladen oder die Team-Liste ruft nur `onAblegen` (dieselbe
 * Rückfrage wie die Liste).
 */
export function EinsatzKartenAnsicht({
  ansicht,
  laden,
  auswahl,
  summe,
  tagText,
  portalZiel,
  onAblegen,
  onEntfernen,
  onNeuLaden,
}: {
  ansicht: EinsatzAnsicht;
  laden: KarteLaden;
  auswahl: Auswahl;
  summe: Summe;
  tagText: string | null;
  portalZiel: HTMLElement | undefined;
  onAblegen: (p: EinsatzPersonLage) => void;
  onEntfernen: (p: EinsatzPersonLage) => void;
  onNeuLaden: () => void;
}) {
  const schmal = useSchmal();
  const [filter, setFilter] = useState<KartenFilter>(FILTER_VORGABE);
  const [umkreis, setUmkreis] = useState<UmkreisKm>(() => umkreisLesen());
  const [offen, setOffen] = useState<Offen>(null);
  const [geist, setGeist] = useState<{
    k: KartenPerson;
    x: number;
    y: number;
    ziel: AblageZiel | null;
  } | null>(null);
  const wurzel = useRef<HTMLDivElement | null>(null);
  const ablage = useRef<HTMLDivElement | null>(null);
  const steuerung = useRef<KartenSteuerung | null>(null);
  const zug = useRef<Zug | null>(null);
  const klickSperre = useRef(false);

  const details = useMemo(() => new Map(ansicht.personen.map((p) => [p.id, p])), [ansicht.personen]);
  const teamIds = useMemo(() => auswahl.team.map((t) => t.employeeId), [auswahl.team]);
  const karte = laden.art === "da" ? laden.karte : null;

  const sichtbar = useMemo(
    () => (karte ? kartenPersonenFiltern(karte.personen, filter, details, teamIds) : []),
    [karte, filter, details, teamIds],
  );
  const { gruppen, ohnePunkt } = useMemo(() => pinGruppen(sichtbar), [sichtbar]);
  const versteckt = karte ? versteckteAbwesende(karte.personen, teamIds) : 0;
  const wegePunkte = useMemo(
    () => (karte ? karte.personen.filter((p) => p.punkt && teamIds.includes(p.employeeId)).map((p) => p.punkt!) : []),
    [karte, teamIds],
  );

  // Ziele für den Treffer: Ablagekreis um Beladen und jede Team-Fläche im Dialog.
  const ziele = useCallback(() => {
    const r = ablage.current?.getBoundingClientRect();
    const dialog = wurzel.current?.closest(".ez-dialog") ?? document;
    const team = [...dialog.querySelectorAll<HTMLElement>("[data-ablage='team']")]
      .map((el) => el.getBoundingClientRect())
      .filter((x) => x.width > 0 && x.height > 0);
    return {
      auftrag: r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
      team,
    };
  }, []);

  const teamFlaechenHeiss = useCallback((heiss: boolean) => {
    const dialog = wurzel.current?.closest(".ez-dialog") ?? document;
    dialog.querySelectorAll<HTMLElement>("[data-ablage='team']").forEach((el) => {
      if (heiss) el.setAttribute("data-heiss", "");
      else el.removeAttribute("data-heiss");
    });
  }, []);

  const beenden = useCallback(
    (ablegen: { x: number; y: number } | null) => {
      const z = zug.current;
      if (!z) return;
      if (z.timer) clearTimeout(z.timer);
      zug.current = null;
      steuerung.current?.schieben(true);
      teamFlaechenHeiss(false);
      setGeist(null);
      if (!z.aktiv) return;
      // Nach einem Ziehen keinen Klick auswerten (sonst öffnet sich die Namensliste).
      klickSperre.current = true;
      setTimeout(() => {
        klickSperre.current = false;
      }, 0);
      if (!ablegen) return;
      const ziel = trefferZiel(ablegen, ziele());
      const p = details.get(z.k.employeeId);
      // Abbruch außerhalb: nichts ändert sich, der Pin steht wieder an seinem Ort.
      if (ziel && p) onAblegen(p);
    },
    [details, onAblegen, teamFlaechenHeiss, ziele],
  );

  useEffect(() => {
    function bewegen(e: PointerEvent) {
      const z = zug.current;
      if (!z || e.pointerId !== z.pointerId) return;
      const weg = Math.hypot(e.clientX - z.start.x, e.clientY - z.start.y);
      if (!z.aktiv) {
        if (z.touch) {
          // Finger bewegt sich vor dem Halten: kein Ziehen, die Karte darf schieben.
          if (weg > HALTEN_TOLERANZ_PX) {
            if (z.timer) clearTimeout(z.timer);
            zug.current = null;
          }
          return;
        }
        if (weg <= ZIEHEN_AB_PX) return;
        z.aktiv = true;
        setOffen(null);
      }
      e.preventDefault();
      const ziel = trefferZiel({ x: e.clientX, y: e.clientY }, ziele());
      teamFlaechenHeiss(ziel === "team");
      setGeist({ k: z.k, x: e.clientX, y: e.clientY, ziel });
    }
    const loslassen = (e: PointerEvent) => {
      if (zug.current && e.pointerId === zug.current.pointerId) beenden({ x: e.clientX, y: e.clientY });
    };
    const abbrechen = (e: PointerEvent) => {
      if (zug.current && e.pointerId === zug.current.pointerId) beenden(null);
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zug.current?.aktiv) {
        e.stopPropagation();
        beenden(null);
      }
    };
    window.addEventListener("pointermove", bewegen, { passive: false });
    window.addEventListener("pointerup", loslassen);
    window.addEventListener("pointercancel", abbrechen);
    window.addEventListener("keydown", taste, true);
    return () => {
      window.removeEventListener("pointermove", bewegen);
      window.removeEventListener("pointerup", loslassen);
      window.removeEventListener("pointercancel", abbrechen);
      window.removeEventListener("keydown", taste, true);
    };
  }, [beenden, teamFlaechenHeiss, ziele]);

  useEffect(
    () => () => {
      if (zug.current?.timer) clearTimeout(zug.current.timer);
      zug.current = null;
    },
    [],
  );

  const ziehenStart = useCallback((k: KartenPerson, e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    const touch = e.pointerType === "touch";
    const z: Zug = {
      k,
      pointerId: e.pointerId,
      touch,
      start: { x: e.clientX, y: e.clientY },
      aktiv: false,
      timer: null,
    };
    if (touch) {
      // Ziehen startet erst nach kurzem Halten; Antippen öffnet die Namensliste.
      z.timer = setTimeout(() => {
        if (zug.current !== z) return;
        z.aktiv = true;
        steuerung.current?.schieben(false);
        setOffen(null);
        setGeist({ k, x: z.start.x, y: z.start.y, ziel: null });
        try {
          navigator.vibrate?.(12);
        } catch {
          // ohne Vibration
        }
      }, HALTEN_MS);
    } else {
      steuerung.current?.schieben(false);
    }
    zug.current = z;
  }, []);

  const oeffnen = useCallback((neu: Exclude<Offen, null>) => {
    if (klickSperre.current) return;
    setOffen((alt) => (alt && alt.art === neu.art && JSON.stringify(alt) === JSON.stringify(neu) ? null : neu));
  }, []);

  const steuerungSetzen = useCallback((s: KartenSteuerung | null) => {
    steuerung.current = s;
  }, []);
  const ablageSetzen = useCallback((el: HTMLDivElement | null) => {
    ablage.current = el;
  }, []);

  const renderPin = useCallback(
    (g: PinGruppe) => (
      <EinsatzPin
        gruppe={g}
        teamIds={teamIds}
        anfahrten={ansicht.anfahrten}
        details={details}
        offen={offen?.art === "gruppe" && offen.schluessel === g.schluessel}
        gezogen={geist !== null && g.personen.some((p) => p.employeeId === geist.k.employeeId)}
        onOeffnen={(x) => oeffnen({ art: "gruppe", schluessel: x.schluessel })}
        onZiehenStart={ziehenStart}
      />
    ),
    [teamIds, ansicht.anfahrten, details, offen, geist, oeffnen, ziehenStart],
  );

  const blattPersonen: KartenPerson[] = useMemo(() => {
    if (!offen || !karte) return [];
    if (offen.art === "gruppe") return gruppen.find((g) => g.schluessel === offen.schluessel)?.personen ?? [];
    const k = karte.personen.find((p) => p.employeeId === offen.id);
    return k ? [k] : [];
  }, [offen, karte, gruppen]);

  const umkreisWaehlen = (km: UmkreisKm) => {
    setUmkreis(km);
    umkreisMerken(km);
  };

  const vorschau = geist ? ziehenVorschau(details.get(geist.k.employeeId)!, auswahl, ansicht) : null;
  const kompakt = kompaktText(auswahl.team.length, summe.vergleich.summeCent, summe.vergleich.differenzCent);

  if (laden.art !== "da") {
    return (
      <section className="ez-karte ezk" aria-labelledby="ezk-titel" ref={wurzel}>
        <div className="ez-karte-kopf">
          <h3 id="ezk-titel">Karte</h3>
          <p>{laden.art === "laedt" ? "Orte werden geladen …" : laden.meldung}</p>
        </div>
        {laden.art === "laedt" ? (
          <div className="ezk-bild" aria-busy="true">
            <span className="lg-skeleton ezk-bild-laden" />
          </div>
        ) : (
          <div className="ezk-fehler">
            <button type="button" className="ez-link" onClick={onNeuLaden}>
              Noch einmal laden
            </button>
          </div>
        )}
      </section>
    );
  }

  const k = laden.karte;
  const hinweise = [...k.hinweise];
  if (gruppen.length > GRUPPEN_HINWEIS_AB)
    hinweise.push(`${gruppen.length} Orte auf der Karte: Filter nutzen, damit es übersichtlich bleibt.`);
  if (!k.beladen) hinweise.push("Ohne Beladen auf der Karte: Pins auf die Team-Liste ziehen.");
  const ohneWohnort = ohnePunkt.filter((p) => !p.ortText);
  const ohneLeisteTitel =
    ohneWohnort.length === ohnePunkt.length ? `Ohne Wohnort (${ohnePunkt.length})` : `Ohne Wohnort oder Kartenpunkt (${ohnePunkt.length})`;

  return (
    <section className="ez-karte ezk" aria-labelledby="ezk-titel" ref={wurzel}>
      <div className="ez-karte-kopf ez-karte-kopf-zeile">
        <div>
          <h3 id="ezk-titel">{tagText ? `Karte am ${tagText}` : "Karte"}</h3>
          <p>Pin auf Beladen oder in die Team-Liste ziehen. {schmal ? "Antippen" : "Klick"} zeigt Anfahrt und Satz.</p>
        </div>
      </div>

      <div className="ezk-filter" role="group" aria-label="Filter der Karte">
        {(
          [
            ["nurFrei", "Nur frei"],
            ["sprinter", "Sprinter"],
            ["pkw", "Eigener PKW"],
          ] as const
        ).map(([schl, text]) => (
          <button
            key={schl}
            type="button"
            className="ezk-chip"
            aria-pressed={filter[schl]}
            onClick={() => setFilter((f) => ({ ...f, [schl]: !f[schl] }))}
          >
            {text}
          </button>
        ))}
        {versteckt > 0 || filter.alle ? (
          <button type="button" className="ezk-chip" aria-pressed={filter.alle} onClick={() => setFilter((f) => ({ ...f, alle: !f.alle }))}>
            {filter.alle ? "Abwesende ausblenden" : `Alle zeigen (${versteckt} abwesend)`}
          </button>
        ) : null}
        <span className="ezk-umkreis" role="group" aria-label="Umkreis um Beladen, Luftlinie, grobe Orientierung">
          <span className="ezk-umkreis-text">Umkreis</span>
          {([0, ...UMKREIS_KM] as UmkreisKm[]).map((km) => (
            <button
              key={km}
              type="button"
              className="ezk-seg"
              aria-pressed={umkreis === km}
              disabled={!k.beladen}
              onClick={() => umkreisWaehlen(km)}
            >
              {km === 0 ? "aus" : `${km} km`}
            </button>
          ))}
        </span>
      </div>

      {hinweise.length > 0 ? (
        <ul className="ez-hinweise ezk-hinweise">
          {hinweise.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}

      <div className="ezk-buehne">
        <div className="ezk-bild">
          <EinsatzKarteBild
            beladen={k.beladen}
            entladen={k.entladen}
            linie={k.linie}
            gruppen={gruppen}
            wegePunkte={wegePunkte}
            umkreisKm={k.beladen ? umkreis : 0}
            ablageHeiss={geist?.ziel === "auftrag"}
            ablageRef={ablageSetzen}
            onSteuerung={steuerungSetzen}
            renderPin={renderPin}
            schmal={schmal}
          />
        </div>
        <div className="ezk-kompakt" data-ablage="team" aria-live="polite">
          {kompakt}
        </div>
        <div className="ezk-legende" aria-hidden="true">
          <span>
            <LageSymbol lage="frei" /> frei
          </span>
          <span>
            <LageSymbol lage="belegt" /> belegt
          </span>
          <span>
            <LageSymbol lage="abwesend" /> abwesend
          </span>
          <span>
            <LageSymbol lage="team" /> im Team
          </span>
          {k.beladen && umkreis > 0 ? <span className="ezk-legende-ring">Umkreis {umkreis} km: Luftlinie, grobe Orientierung</span> : null}
        </div>
        {blattPersonen.length > 0 ? (
          <PersonenBlatt
            personen={blattPersonen}
            details={details}
            ansicht={ansicht}
            auswahl={auswahl}
            tagText={tagText}
            onSchliessen={() => setOffen(null)}
            onZiehenStart={ziehenStart}
            onAblegen={onAblegen}
            onEntfernen={onEntfernen}
          />
        ) : null}
      </div>

      {ohnePunkt.length > 0 ? (
        <div className="ezk-ohne" role="group" aria-label={ohneLeisteTitel}>
          <span className="ezk-ohne-titel">{ohneLeisteTitel}</span>
          {ohnePunkt.map((p) => (
            <button
              key={p.employeeId}
              type="button"
              className="ezk-ohne-person"
              data-lage={teamIds.includes(p.employeeId) ? "team" : p.lage}
              aria-label={`${p.name}, ${p.ortText ? `${p.ortText} ohne Kartenpunkt` : "ohne Wohnort"}, ${lageWort(details.get(p.employeeId), p)}${teamIds.includes(p.employeeId) ? ", im Team" : ""}`}
              onPointerDown={(e) => ziehenStart(p, e)}
              onClick={() => oeffnen({ art: "person", id: p.employeeId })}
            >
              <LageSymbol lage={teamIds.includes(p.employeeId) ? "team" : p.lage} />
              <span className="ezk-pin-kreis">{p.kuerzel}</span>
              {p.name}
              {p.ortText ? <small>{p.ortText}</small> : null}
            </button>
          ))}
        </div>
      ) : null}


      {geist && portalZiel
        ? createPortal(
            <div className="ezk-geist" style={{ left: geist.x, top: geist.y }} aria-hidden="true">
              <span className="ezk-geist-pin" data-lage={imTeam(auswahl, geist.k.employeeId) ? "team" : geist.k.lage}>
                <span className="ezk-pin-kreis">{geist.k.kuerzel}</span>
                {geist.k.name}
              </span>
              <span className="ezk-geist-text" data-ziel={geist.ziel ?? undefined}>
                {geist.ziel && vorschau
                  ? vorschau.schonImTeam
                    ? "Schon im Team"
                    : `Ins Team: ${vorschau.text}${vorschau.rueckfrage === "belegt" ? ". Rückfrage, weil belegt" : vorschau.rueckfrage === "abwesend" ? ". Rückfrage, weil abwesend" : ""}`
                  : "Auf Beladen oder die Team-Liste ziehen. Woanders loslassen bricht ab."}
              </span>
            </div>,
            portalZiel,
          )
        : null}
    </section>
  );
}

/** Namensliste eines Pins (Bündel) oder einer Person ohne Kartenpunkt. */
function PersonenBlatt({
  personen,
  details,
  ansicht,
  auswahl,
  tagText,
  onSchliessen,
  onZiehenStart,
  onAblegen,
  onEntfernen,
}: {
  personen: KartenPerson[];
  details: ReadonlyMap<string, EinsatzPersonLage>;
  ansicht: EinsatzAnsicht;
  auswahl: Auswahl;
  tagText: string | null;
  onSchliessen: () => void;
  onZiehenStart: (k: KartenPerson, e: ReactPointerEvent<HTMLElement>) => void;
  onAblegen: (p: EinsatzPersonLage) => void;
  onEntfernen: (p: EinsatzPersonLage) => void;
}) {
  const erster = useRef<HTMLButtonElement | null>(null);
  const ids = personen.map((p) => p.employeeId).join(",");
  // Fokus auf „Ins Team“ beim Öffnen (Tastaturweg), nicht bei jeder Teamänderung.
  useEffect(() => {
    erster.current?.focus({ preventScroll: true });
  }, [ids]);
  const ort = personen[0]?.ortText;
  return (
    <div
      className="ezk-blatt"
      role="dialog"
      aria-label={personen.length > 1 ? `${personen.length} Personen in ${ort ?? "einem Ort"}` : (personen[0]?.name ?? "Person")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onSchliessen();
        }
      }}
    >
      <div className="ezk-blatt-kopf">
        <b>{personen.length > 1 ? `${personen.length} in ${ort ?? "einem Ort"}` : (ort ?? "ohne Wohnort")}</b>
        <button type="button" className="ezk-blatt-zu" onClick={onSchliessen} aria-label="Namensliste schließen">
          ×
        </button>
      </div>
      <ul>
        {personen.map((k, i) => {
          const p = details.get(k.employeeId);
          if (!p) return null;
          const an = ansicht.anfahrten.find((a) => a.employeeId === k.employeeId);
          const drin = imTeam(auswahl, k.employeeId);
          return (
            <li key={k.employeeId} className="ezk-blatt-person" data-lage={drin ? "team" : k.lage}>
              <span
                className="ezk-pin-kreis ezk-griff"
                onPointerDown={(e) => onZiehenStart(k, e)}
                title="Ziehen auf Beladen oder die Team-Liste"
                aria-hidden="true"
              >
                {k.kuerzel}
              </span>
              <div className="ezk-blatt-text">
                <b>{k.name}</b>
                <span className="ezk-blatt-lage">
                  <LageSymbol lage={drin ? "team" : k.lage} />
                  {drin ? "im Team" : `${tagText ? `am ${tagText} ` : ""}${lageWort(p, k)}`}
                </span>
                <small>
                  {p.lage === "abwesend"
                    ? "Anfahrt nicht abgefragt"
                    : an
                      ? `Anfahrt ${anfahrtText(an.anKm, an.anMin, an.anMinQuelle)}, zurück ${anfahrtText(an.abKm, an.abMin, "geschaetzt")}`
                      : "Anfahrt unbekannt"}
                </small>
                <small>
                  Arbeit {satzText(p.satzArbeitCent)} · Fahrt {satzText(p.satzFahrtCent)} je h{p.kannSprinter ? " · Sprinter" : ""}
                  {p.eigenerPkw ? " · eigener PKW" : ""}
                </small>
              </div>
              <button
                ref={i === 0 ? erster : undefined}
                type="button"
                className="ezk-blatt-knopf"
                data-art={drin ? "raus" : "rein"}
                onClick={() => (drin ? onEntfernen(p) : onAblegen(p))}
              >
                {drin ? "Aus dem Team" : "Ins Team"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
