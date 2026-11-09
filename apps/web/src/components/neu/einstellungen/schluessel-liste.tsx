"use client";

import Link from "next/link";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { zuletztBenutztText, type ApiSchluesselAnsicht } from "@/lib/einstellungen-uebersicht";
import { datumText } from "./einstellungen-logik";
import { TEXT } from "./texte";

/** Zugänge (Entscheidung 11): API-Schlüssel nur lesen. */
export function SchluesselListe({ schluessel, jetzt }: { schluessel: ApiSchluesselAnsicht[]; jetzt: Date }) {
  return (
    <section className="einst-bereich" id="schluessel" aria-labelledby="einst-zugaenge">
      <div className="einst-bereich-kopf">
        <h2 className="einst-bereich-titel" id="einst-zugaenge">
          {TEXT.abschnittZugaenge}
        </h2>
        <p className="einst-satz">
          {TEXT.schluesselSatz} <Link href="/settings/api-keys">{TEXT.schluesselVerwalten}</Link>
        </p>
      </div>
      <GlassPanel variant="panel" className="einst-karte">
        <h3>{TEXT.schluessel}</h3>
        {schluessel.length === 0 ? (
          <p className="einst-leer">{TEXT.schluesselLeer}</p>
        ) : (
          <div className="einst-tabelle-huelle">
            <table className="einst-tabelle">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Präfix</th>
                  <th scope="col">Zugriff</th>
                  <th scope="col">Zuletzt benutzt</th>
                  <th scope="col">Läuft ab</th>
                </tr>
              </thead>
              <tbody>
                {schluessel.map((k) => (
                  <tr key={k.id} data-aus={k.abgelaufen || undefined}>
                    <td>
                      {k.name}
                      {k.abgelaufen ? (
                        <span className="einst-marke" data-ton="rose">
                          {TEXT.schluesselAbgelaufen}
                        </span>
                      ) : k.ungenutzt ? (
                        <span className="einst-marke" data-ton="gold">
                          {TEXT.schluesselUngenutzt}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <code>{k.prefix}…</code>
                    </td>
                    <td>{k.zugriff === "lesen" ? "nur lesen" : "voll"}</td>
                    <td>{zuletztBenutztText(k.zuletztBenutztAm, jetzt)}</td>
                    <td>{k.laeuftAbAm ? datumText(k.laeuftAbAm) : "nie"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </section>
  );
}
