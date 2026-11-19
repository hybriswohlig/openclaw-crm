"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { FELD_TEXT, type ImportZeile } from "@/lib/mitarbeiter-csv";

interface Ergebnis {
  zeilen: ImportZeile[];
  kopfFehlt: string[];
  uebernommen: number;
}

const ART_TEXT: Record<ImportZeile["art"], string> = { aendern: "ändern", neu: "neu anlegen", gleich: "unverändert", fehler: "Fehler" };

/**
 * Mitarbeiter-Tabelle: Vorlage herunterladen (CSV für Excel), ausgefüllt
 * wieder hochladen, Vorschau, dann übernehmen. Leere Zellen ändern nichts.
 */
export function MitarbeiterImport({ onFertig }: { onFertig: () => void }) {
  const portalZiel = usePortalZiel();
  const datei = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<Ergebnis | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function senden(text: string, uebernehmen: boolean) {
    setLaeuft(true);
    const r = await apiAufruf<Ergebnis>("/api/v1/einsatz/mitarbeiter/import", jsonAufruf("POST", { csv: text, uebernehmen }));
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
    toast.success(`${e.uebernommen} ${e.uebernommen === 1 ? "Person" : "Personen"} gespeichert.`, fehler > 0 ? { description: `${fehler} Zeilen mit Fehlern blieben unverändert.` } : undefined);
    setVorschau(fehler > 0 ? e : null);
    onFertig();
  }

  const z = vorschau?.zeilen ?? [];
  const zaehl = (a: ImportZeile["art"]) => z.filter((x) => x.art === a).length;
  const zuSpeichern = zaehl("aendern") + zaehl("neu");

  return (
    <>
      <a className="ez-crew-link ma-import-link" href="/api/v1/einsatz/mitarbeiter/vorlage" download="mitarbeiter.csv">
        Tabelle herunterladen
      </a>
      <GlassButton type="button" size="sm" variant="ghost" disabled={laeuft} onClick={() => datei.current?.click()}>
        Tabelle importieren
      </GlassButton>
      <input ref={datei} type="file" accept=".csv,text/csv" hidden onChange={(e) => void gewaehlt(e.target.files?.[0])} />

      <GlassDialog open={vorschau !== null} onOpenChange={(o) => (o ? undefined : setVorschau(null))}>
        {vorschau ? (
          <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="ma-import">
            <GlassDialogTitle>Tabelle prüfen</GlassDialogTitle>
            <GlassDialogDescription>
              {vorschau.kopfFehlt.length > 0
                ? `In der Kopfzeile fehlt: ${vorschau.kopfFehlt.join(", ")}. Bitte die heruntergeladene Tabelle verwenden.`
                : `${zaehl("aendern")} ändern · ${zaehl("neu")} neu · ${zaehl("gleich")} unverändert · ${zaehl("fehler")} mit Fehler. Leere Zellen ändern nichts.`}
            </GlassDialogDescription>
            <div className="ma-import-liste">
              {z
                .filter((x) => x.art !== "gleich")
                .map((x) => (
                  <div key={x.nr} className={`ma-import-zeile ${x.art}`}>
                    <div className="ma-import-kopf">
                      <b>{x.name || "Ohne Namen"}</b>
                      <span className="ma-import-art">{ART_TEXT[x.art]}</span>
                      <small>Zeile {x.nr}</small>
                    </div>
                    {x.aenderungen.length > 0 ? (
                      <ul>
                        {x.aenderungen.map((a) => (
                          <li key={a.feld}>
                            {FELD_TEXT[a.feld]}: <s>{a.alt}</s> → <b>{a.neu}</b>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {x.fehler.length > 0 ? (
                      <ul className="ma-import-fehler">
                        {x.fehler.map((f, i) => (
                          <li key={i}>
                            {f.feld ? `${f.feld}: ` : ""}
                            {f.text}
                          </li>
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
              <GlassButton type="button" disabled={laeuft || zuSpeichern === 0 || vorschau.kopfFehlt.length > 0} onClick={() => void uebernehmen()}>
                {laeuft ? "Einen Moment …" : `${zuSpeichern} übernehmen`}
              </GlassButton>
            </div>
          </GlassDialogContent>
        ) : null}
      </GlassDialog>
    </>
  );
}
