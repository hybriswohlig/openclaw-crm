"use client";

import { useId } from "react";
import type { TagesRasterZelle } from "@/lib/angebot-wahl";
import { euroText, tagKurz } from "@/lib/anzeige";
import { Stern } from "./termin-raster";
import {
  gruendeText,
  MAX_NOTIZ,
  MAX_TAGE,
  SCHNELL_SLOTS,
  slotUmschalten,
  wirksamerPreisCent,
  type AuswahlTag,
} from "./termin-logik";

/**
 * Die angebotenen Tage (rechts neben dem Raster, am Handy darunter): je Tag
 * Preis, Margengründe, Empfehlung (genau eine), Zeitfenster, Notiz für den
 * Kunden und eine Preis-Anpassung mit Pflichtgrund. Die Untergrenze (30 %
 * Marge) prüft der Dienst beim Speichern.
 */
export function TerminAuswahl({
  auswahl,
  zellen,
  gesperrt,
  onAendern,
  onEmpfehlen,
  onEntfernen,
}: {
  auswahl: readonly AuswahlTag[];
  zellen: Readonly<Record<string, TagesRasterZelle>>;
  gesperrt: boolean;
  onAendern: (datum: string, aendern: (t: AuswahlTag) => AuswahlTag) => void;
  onEmpfehlen: (datum: string) => void;
  onEntfernen: (datum: string) => void;
}) {
  const name = useId();
  return (
    <section className="termin-auswahl" aria-label="Angebotene Tage">
      <div className="termin-auswahl-kopf">
        <h3>Angebotene Tage</h3>
        <span>
          {auswahl.length} von {MAX_TAGE}
        </span>
      </div>
      {auswahl.length === 0 ? (
        <p className="termin-leer">Noch kein Tag gewählt. Tippe im Kalender auf die Tage, die du dem Kunden anbieten willst.</p>
      ) : (
        <ul className="termin-wahl-liste">
          {auswahl.map((t) => (
            <WahlZeile
              key={t.datum}
              tag={t}
              zelle={zellen[t.datum]}
              gruppe={name}
              gesperrt={gesperrt}
              onAendern={(f) => onAendern(t.datum, f)}
              onEmpfehlen={() => onEmpfehlen(t.datum)}
              onEntfernen={() => onEntfernen(t.datum)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WahlZeile({
  tag,
  zelle,
  gruppe,
  gesperrt,
  onAendern,
  onEmpfehlen,
  onEntfernen,
}: {
  tag: AuswahlTag;
  zelle: TagesRasterZelle | undefined;
  gruppe: string;
  gesperrt: boolean;
  onAendern: (aendern: (t: AuswahlTag) => AuswahlTag) => void;
  onEmpfehlen: () => void;
  onEntfernen: () => void;
}) {
  const id = useId();
  const text = tagKurz(tag.datum);
  const rechner = zelle?.preisCent ?? null;
  const wirksam = wirksamerPreisCent(tag, zelle);
  const angepasst = tag.anpassung !== null && wirksam !== null && wirksam !== rechner;
  const gruende = zelle ? gruendeText(zelle.gruende) : "";
  const grundFehlt = tag.anpassung !== null && tag.anpassung.betrag.trim() !== "" && tag.anpassung.grund.trim() === "";

  return (
    <li className="termin-wahl" data-empfohlen={tag.empfohlen || undefined}>
      <div className="termin-wahl-kopf">
        <b>
          {text}
          {zelle?.feiertag ? <span className="termin-wahl-marke">Feiertag</span> : null}
        </b>
        <span className="termin-wahl-preis">
          {angepasst && rechner !== null ? <s aria-label={`Rechnerpreis ${euroText(rechner)}`}>{euroText(rechner)}</s> : null}
          {wirksam !== null ? euroText(wirksam) : zelle ? "kein Preis" : "Preis lädt"}
        </span>
      </div>
      {gruende ? <p className="termin-wahl-gruende">{gruende}</p> : null}

      <div className="termin-wahl-zeile">
        <label className="termin-empfehlen">
          <input type="radio" name={gruppe} checked={tag.empfohlen} disabled={gesperrt} onChange={onEmpfehlen} />
          {tag.empfohlen ? (
            <>
              <Stern /> Empfohlen
            </>
          ) : (
            "Empfehlen"
          )}
        </label>
        <div className="termin-slots" role="group" aria-label={`Zeitfenster am ${text}`}>
          {SCHNELL_SLOTS.map((s) => {
            const an = tag.slots.some((x) => x.label === s.label);
            return (
              <button
                key={s.label}
                type="button"
                className="termin-slot"
                aria-pressed={an}
                disabled={gesperrt}
                title={`${s.startTime} bis ${s.endTime}`}
                onClick={() => onAendern((t) => slotUmschalten(t, s))}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="termin-feld" htmlFor={`${id}-notiz`}>
        <span className="termin-sr">Notiz für den Kunden am {text}</span>
        <input
          id={`${id}-notiz`}
          className="lg-input"
          value={tag.note}
          maxLength={MAX_NOTIZ}
          disabled={gesperrt}
          placeholder="Hinweis für den Kunden (optional)"
          onChange={(e) => {
            const note = e.target.value;
            onAendern((t) => ({ ...t, note }));
          }}
        />
      </label>

      {tag.anpassung ? (
        <div className="termin-anpassung">
          <div className="termin-anpassung-felder">
            <label className="termin-feld" htmlFor={`${id}-betrag`}>
              Neuer Preis
              <input
                id={`${id}-betrag`}
                className="lg-input"
                inputMode="decimal"
                value={tag.anpassung.betrag}
                disabled={gesperrt}
                placeholder={rechner !== null ? String(rechner / 100) : "Betrag in €"}
                onChange={(e) => {
                  const betrag = e.target.value;
                  onAendern((t) => ({ ...t, anpassung: { betrag, grund: t.anpassung?.grund ?? "" } }));
                }}
              />
            </label>
            <label className="termin-feld" htmlFor={`${id}-grund`}>
              Grund (Pflicht)
              <input
                id={`${id}-grund`}
                className="lg-input"
                value={tag.anpassung.grund}
                disabled={gesperrt}
                aria-invalid={grundFehlt || undefined}
                placeholder="Etwa: Stammkunde, Rückfahrt ohnehin geplant"
                onChange={(e) => {
                  const grund = e.target.value;
                  onAendern((t) => ({ ...t, anpassung: { betrag: t.anpassung?.betrag ?? "", grund } }));
                }}
              />
            </label>
          </div>
          <p className="termin-hilfe">Nie unter dem Preis bei 30 % Marge; das prüft das CRM beim Speichern.</p>
          <button
            type="button"
            className="termin-kleinknopf"
            disabled={gesperrt}
            onClick={() => onAendern((t) => ({ ...t, anpassung: null }))}
          >
            Rechnerpreis nehmen
          </button>
        </div>
      ) : null}

      <div className="termin-wahl-fuss">
        {tag.anpassung ? null : (
          <button
            type="button"
            className="termin-kleinknopf"
            disabled={gesperrt}
            onClick={() => onAendern((t) => ({ ...t, anpassung: { betrag: "", grund: "" } }))}
          >
            Preis anpassen
          </button>
        )}
        <button type="button" className="termin-kleinknopf" data-ton="rose" disabled={gesperrt} onClick={onEntfernen}>
          Entfernen
        </button>
      </div>
    </li>
  );
}
