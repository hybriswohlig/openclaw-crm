"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { TeamImportZeile } from "@/lib/auftraege-csv";

interface Ergebnis {
  zeilen: TeamImportZeile[];
  kopfFehlt: string[];
  uebernommen: number;
}

/**
 * Auftrags-Tabelle: anstehende Umzüge mit Team herunterladen (CSV für Excel),
 * Teamleitung und Helfer eintragen, wieder hochladen, Vorschau, übernehmen.
 * Beide Team-Zellen leer ändern nichts. Beim Import geht keine WhatsApp raus.
 */
export function AuftraegeImport({ onFertig }: { onFertig: () => void }) {
  const portalZiel = usePortalZiel();
  const datei = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<Ergebnis | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function senden(text: string, uebernehmen: boolean) {
    setLaeuft(true);
    const r = await apiAufruf<Ergebnis>("/api/v1/einsatz/auftraege/import", jsonAufruf("POST", { csv: text, uebernehmen }));
    setLaeuft(false);
    if (!r.ok) {
      toast.error("Tabelle nicht gelesen.", { description: r.message });
      return null;
    }
    return r.data ?? null;
  }

  async function gewaehlt(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    const e = await senden(text, false);
    if (e) setVorschau(e);
    if (datei.current) datei.current.value = "";
  }

  async function uebernehmen() {
    if (!csv) return;
    const e = await senden(csv, true);
    if (!e) return;
    const fehler = e.zeilen.filter((z) => z.art === "fehler").length;
    toast.success(`${e.uebernommen} ${e.uebernommen === 1 ? "Team" : "Teams"} gespeichert.`, fehler > 0 ? { description: `${fehler} Aufträge mit Fehlern blieben unverändert.` } : undefined);
    setVorschau(fehler > 0 ? e : null);
    onFertig();
  }

  const z = vorschau?.zeilen ?? [];
  const zaehl = (a: TeamImportZeile["art"]) => z.filter((x) => x.art === a).length;

  return (
    <>
      <a className="ez-crew-link ma-import-link" href="/api/v1/einsatz/auftraege/vorlage" download="auftraege-team.csv">
        Aufträge herunterladen
      </a>
      <GlassButton type="button" size="sm" variant="ghost" disabled={laeuft} onClick={() => datei.current?.click()}>
        Aufträge importieren
      </GlassButton>
      <input ref={datei} type="file" accept=".csv,text/csv" hidden onChange={(e) => void gewaehlt(e.target.files?.[0])} />

      <GlassDialog open={vorschau !== null} onOpenChange={(o) => (o ? undefined : setVorschau(null))}>
        {vorschau ? (
          <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="ma-import">
            <GlassDialogTitle>Teams prüfen</GlassDialogTitle>
            <GlassDialogDescription>
              {vorschau.kopfFehlt.length > 0
                ? `In der Kopfzeile fehlt: ${vorschau.kopfFehlt.join(", ")}. Bitte die heruntergeladene Tabelle verwenden.`
                : `${zaehl("aendern")} ändern · ${zaehl("gleich")} unverändert · ${zaehl("fehler")} mit Fehler. Leere Team-Zellen ändern nichts, es geht keine WhatsApp raus.`}
            </GlassDialogDescription>
            <div className="ma-import-liste">
              {z
                .filter((x) => x.art !== "gleich")
                .map((x) => (
                  <div key={x.nr} className={`ma-import-zeile ${x.art}`}>
                    <div className="ma-import-kopf">
                      <b>{x.titel || "Ohne Namen"}</b>
                      <span className="ma-import-art">{x.art === "aendern" ? "Team ändern" : "Fehler"}</span>
                      <small>{x.datum || `Zeile ${x.nr}`}</small>
                    </div>
                    {x.art === "aendern" ? (
                      <ul>
                        <li>
                          <s>{x.alt.length > 0 ? x.alt.join(", ") : "niemand"}</s> → <b>{x.neu.length > 0 ? x.neu.join(", ") : "niemand"}</b>
                          {x.neu.length > 0 ? <small> (leitet: {x.neu[0]})</small> : null}
                        </li>
                      </ul>
                    ) : null}
                    {x.hinweise.length > 0 ? (
                      <ul className="ma-import-hinweis">
                        {x.hinweise.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    ) : null}
                    {x.fehler.length > 0 ? (
                      <ul className="ma-import-fehler">
                        {x.fehler.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              {z.every((x) => x.art === "gleich") && vorschau.kopfFehlt.length === 0 ? <p className="ma-leer">Nichts zu ändern.</p> : null}
            </div>
            <div className="ma-import-fuss">
              <GlassButton type="button" variant="ghost" onClick={() => setVorschau(null)}>
                Abbrechen
              </GlassButton>
              <GlassButton type="button" disabled={laeuft || zaehl("aendern") === 0 || vorschau.kopfFehlt.length > 0} onClick={() => void uebernehmen()}>
                {laeuft ? "Einen Moment …" : `${zaehl("aendern")} übernehmen`}
              </GlassButton>
            </div>
          </GlassDialogContent>
        ) : null}
      </GlassDialog>
    </>
  );
}
