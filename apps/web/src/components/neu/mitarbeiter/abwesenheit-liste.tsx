"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import {
  ABWESENHEIT_ARTEN,
  ABWESENHEIT_TEXT,
  EINSATZ_FEHLER_TEXT,
  pruefeAbwesenheit,
  type Abwesenheit,
  type AbwesenheitArt,
} from "@/lib/einsatz";
import { abwesenheitAnlegen, abwesenheitLoeschen } from "./mitarbeiter-api";

const ART_GROSS: Record<AbwesenheitArt, string> = { urlaub: "Urlaub", krank: "Krank", gesperrt: "Gesperrt" };

function zeitraum(a: Pick<Abwesenheit, "von" | "bis">): string {
  return a.von === a.bis ? tagKurz(a.von) : `${tagKurz(a.von)} bis ${tagKurz(a.bis)}`;
}

/**
 * Ausnahmen einer Person (E1: ohne Eintrag frei): Liste mit Zeitraum und Art,
 * „+ Abwesenheit“ als kleines Formular, Löschen je Eintrag.
 */
export function AbwesenheitListe({
  employeeId,
  liste,
  onGeaendert,
}: {
  employeeId: string;
  liste: Abwesenheit[];
  onGeaendert: () => void | Promise<void>;
}) {
  const heute = berlinDateString();
  const [offen, setOffen] = useState(false);
  const [von, setVon] = useState(heute);
  const [bis, setBis] = useState(heute);
  const [art, setArt] = useState<AbwesenheitArt>("urlaub");
  const [notiz, setNotiz] = useState("");
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const kommend = liste.filter((a) => a.bis >= heute).sort((a, b) => a.von.localeCompare(b.von));
  const vergangen = liste.filter((a) => a.bis < heute).sort((a, b) => b.von.localeCompare(a.von)).slice(0, 3);
  const fehler = offen ? pruefeAbwesenheit({ von, bis, art }) : null;

  async function speichern() {
    if (fehler) return;
    setLaeuft("neu");
    const r = await abwesenheitAnlegen(employeeId, { von, bis, art, notiz: notiz.trim() || null });
    setLaeuft(null);
    if (!r.ok) {
      toast.error("Abwesenheit nicht gespeichert.", { description: r.message });
      return;
    }
    setOffen(false);
    setNotiz("");
    await onGeaendert();
  }

  async function loeschen(id: string) {
    setLaeuft(id);
    const r = await abwesenheitLoeschen(id);
    setLaeuft(null);
    if (!r.ok) {
      toast.error("Abwesenheit nicht gelöscht.", { description: r.message });
      return;
    }
    await onGeaendert();
  }

  const zeile = (a: Abwesenheit, alt: boolean) => (
    <li key={a.id} className="ma-abw" data-alt={alt || undefined}>
      <span className="ma-abw-art" data-art={a.art}>
        {ART_GROSS[a.art]}
      </span>
      <span className="ma-abw-zeit">
        {zeitraum(a)}
        {a.notiz ? <small>{a.notiz}</small> : null}
      </span>
      <button
        type="button"
        className="ez-link"
        disabled={laeuft === a.id}
        onClick={() => void loeschen(a.id)}
        aria-label={`${ABWESENHEIT_TEXT[a.art]} ${zeitraum(a)} löschen`}
      >
        Löschen
      </button>
    </li>
  );

  return (
    <div className="ma-abwesenheiten">
      <div className="ma-abschnitt-kopf">
        <h3>Abwesenheiten</h3>
        {!offen ? (
          <button type="button" className="ez-link" onClick={() => setOffen(true)}>
            + Abwesenheit
          </button>
        ) : null}
      </div>
      <p className="ma-hinweis">Ohne Eintrag gilt die Person als frei. Nur Urlaub, krank oder gesperrt eintragen.</p>
      {offen ? (
        <div className="ma-abw-form">
          <label>
            <span>Von</span>
            <input type="date" value={von} onChange={(e) => setVon(e.target.value)} />
          </label>
          <label>
            <span>Bis</span>
            <input type="date" value={bis} min={von} onChange={(e) => setBis(e.target.value)} />
          </label>
          <label>
            <span>Art</span>
            <select value={art} onChange={(e) => setArt(e.target.value as AbwesenheitArt)}>
              {ABWESENHEIT_ARTEN.map((x) => (
                <option key={x} value={x}>
                  {ART_GROSS[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="ma-abw-notiz">
            <span>Notiz</span>
            <input type="text" maxLength={200} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="optional" />
          </label>
          {fehler ? <p className="ma-fehler">{EINSATZ_FEHLER_TEXT[fehler]} Höchstens 92 Tage am Stück.</p> : null}
          <div className="ma-knoepfe">
            <GlassButton type="button" size="sm" variant="ghost" onClick={() => setOffen(false)}>
              Abbrechen
            </GlassButton>
            <GlassButton type="button" size="sm" onClick={() => void speichern()} disabled={!!fehler || laeuft === "neu"}>
              {laeuft === "neu" ? "Speichert …" : "Eintragen"}
            </GlassButton>
          </div>
        </div>
      ) : null}
      {kommend.length === 0 && !offen ? <p className="ma-leer">Keine kommenden Abwesenheiten.</p> : null}
      <ul className="ma-abw-liste">
        {kommend.map((a) => zeile(a, false))}
        {vergangen.map((a) => zeile(a, true))}
      </ul>
    </div>
  );
}
