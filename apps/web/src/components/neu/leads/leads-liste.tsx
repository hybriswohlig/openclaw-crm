"use client";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import { LISTEN_SPALTEN, spaltenTon, type LeadKarte, type LeadsAnsicht, type LeadsListe as Liste, type ListenSpalte } from "@/lib/leads-board";
import { akteUrl } from "./lead-karte";
import { listenUnterzeile, sortSchluessel, zellenText } from "./leads-logik";
import { SpaltenWahl } from "./spalten-wahl";

/** Spalten, die rechtsbündig stehen (Zahlen). */
const RECHTS: ReadonlySet<ListenSpalte> = new Set<ListenSpalte>(["betrag"]);

/**
 * Die Liste (Entscheidung 15): Tabelle auf fast deckendem Weiß, kein Glas;
 * Spalten aus der gespeicherten Ansicht, sortierbar per Klick auf den Kopf
 * (Wartet, Termin, Betrag, Quelle, Stufe); 50 Zeilen je Seite; eine Zeile
 * führt in die Akte. Nur lesend.
 */
export function LeadsListe({
  liste,
  ansicht,
  endstufen,
  laedtMehr,
  onSortieren,
  onSpalte,
  onMehr,
  onEndstufen,
  onOeffnen,
}: {
  liste: Liste;
  ansicht: LeadsAnsicht;
  endstufen: boolean;
  laedtMehr: boolean;
  onSortieren: (schluessel: NonNullable<ReturnType<typeof sortSchluessel>>) => void;
  onSpalte: (key: ListenSpalte) => void;
  onMehr: () => void;
  onEndstufen: (zeigen: boolean) => void;
  onOeffnen: (karte: LeadKarte) => void;
}) {
  const spalten = LISTEN_SPALTEN.filter((s) => ansicht.listenSpalten.includes(s.key));
  const sort = ansicht.sortierung;

  return (
    <section className="leads-liste-panel" aria-label="Liste">
      <div className="leads-liste-kopf">
        <div>
          <h2 className="leads-liste-titel">Leads</h2>
          <p className="leads-liste-unter">{listenUnterzeile(liste.gesamt)}</p>
        </div>
        <SpaltenWahl gewaehlt={ansicht.listenSpalten} onUmschalten={onSpalte} />
      </div>

      <div className="leads-tabelle-rahmen">
        <table className="leads-tabelle">
          <thead>
            <tr>
              {spalten.map((s) => {
                const schluessel = sortSchluessel(s.key);
                const aktiv = schluessel !== null && sort.schluessel === schluessel;
                return (
                  <th
                    key={s.key}
                    scope="col"
                    data-rechts={RECHTS.has(s.key) || undefined}
                    aria-sort={aktiv ? (sort.richtung === "auf" ? "ascending" : "descending") : undefined}
                  >
                    {schluessel ? (
                      <button type="button" className="leads-sortier-knopf" data-aktiv={aktiv || undefined} onClick={() => onSortieren(schluessel)}>
                        {s.label}
                        <svg viewBox="0 0 24 24" aria-hidden="true" data-richtung={aktiv ? sort.richtung : undefined}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    ) : (
                      s.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {liste.zeilen.map((k) => (
              <tr
                key={k.id}
                className="leads-zeile"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  onOeffnen(k);
                }}
              >
                {spalten.map((s) => (
                  <td key={s.key} data-rechts={RECHTS.has(s.key) || undefined} data-spalte={s.key}>
                    {s.key === "name" ? (
                      <Link href={akteUrl(k.id)} className="leads-zeile-name">
                        {k.name}
                      </Link>
                    ) : s.key === "stufe" ? (
                      <span className="leads-zeile-stufe">
                        <i className="leads-punkt" data-ton={spaltenTon(k.stufe.kategorie)} aria-hidden="true" />
                        {k.stufe.label}
                      </span>
                    ) : s.key === "wartet" && k.wartet.text ? (
                      <span className="leads-wartet" data-ton={k.wartet.ton ?? undefined}>
                        <i aria-hidden="true" />
                        {k.wartet.text}
                      </span>
                    ) : s.key === "betrag" ? (
                      <span className="leads-karte-betrag" data-art={k.betrag?.art ?? "ohne"}>
                        {k.betragText}
                      </span>
                    ) : s.key === "firma" && k.firma ? (
                      <span className="leads-zeile-firma">
                        <i className="leads-firma" style={{ background: k.firma.farbe }} aria-hidden="true" />
                        {k.firma.name}
                      </span>
                    ) : (
                      zellenText(k, s.key)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {liste.zeilen.length === 0 ? <p className="leads-liste-leer">Keine Leads in dieser Auswahl.</p> : null}
      </div>

      <div className="leads-liste-fuss">
        {liste.weiter !== null ? (
          <GlassButton size="sm" variant="soft" disabled={laedtMehr} onClick={onMehr}>
            {laedtMehr ? "Lädt …" : `Mehr laden (${liste.gesamt - liste.zeilen.length} weitere)`}
          </GlassButton>
        ) : null}
        <span className="leads-liste-endstufen">
          {endstufen ? "Verloren und Kein Lead werden angezeigt" : "Verloren und Kein Lead sind ausgeblendet"}
          <span aria-hidden="true"> · </span>
          <button type="button" className="leads-eingeklappt-knopf" onClick={() => onEndstufen(!endstufen)}>
            {endstufen ? "ausblenden" : "anzeigen"}
          </button>
        </span>
      </div>
    </section>
  );
}
