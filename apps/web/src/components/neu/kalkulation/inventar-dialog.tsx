"use client";

import "@/styles/neu-kalk-p15.css";

import { useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { InventarListe, InventarListeZeile } from "@/lib/kalkulation-inventar";
import { GROESSENKLASSE_TEXT, GROESSENKLASSEN } from "@/lib/kalkulation-p15";
import { Herkunftsmarke } from "./grundlage-zeile";
import { MontageWahlListe } from "./montage-wahl";
import type { KalkKontext } from "./kalk-seite";

const K2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const G = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

const WER_TEXT = { wir: "machen wir", kunde: "Kunde", nicht_noetig: "nicht nötig" } as const;

/** „Demontage 30 min (machen wir)“, ohne Minuten nur die Seite. */
export function arbeitText(was: "Demontage" | "Montage", a: InventarListeZeile["demontage"]): string {
  if (a.wer !== "wir") return `${was}: ${WER_TEXT[a.wer]}`;
  return a.min !== null ? `${was} ${G.format(a.min)} min (machen wir)` : `${was}: machen wir, ohne Katalogzeit`;
}

type Form =
  | { art: "aendern"; id: string; name: string; menge: string; groesse: string; volumen: string }
  | { art: "zeit"; key: string; name: string; minuten: string; grund: string }
  | { art: "neu"; name: string; menge: string };

/**
 * Inventarliste der Kalkulation (Plan 15, Bauteil 14): je Zeile Name, Menge,
 * Herkunft mit Foto, Katalogtreffer, Größe, m³, kg, Tragezeit, Demontage und
 * Montage, Mindestträger (das Teil, das das Team bestimmt, ist markiert). Ändern,
 * Entfernen und Hinzufügen schreiben über die bestehenden Inventar-Routen
 * (deal_inventory_items, Herkunft „von Hand“); danach rechnet der Entwurf neu.
 * Mehraufwand je Teil ist ein Zeitposten mit Bezug zum Teil (Schlüssel `teil.<name>`).
 */
export function InventarDialog({
  liste,
  kontext,
  portalZiel,
  onSchliessen,
  onVolumen,
}: {
  liste: InventarListe;
  kontext: KalkKontext;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onVolumen?: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState<Form | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [montage, setMontage] = useState(false);
  const beschaeftigt = laeuft || kontext.laeuft !== null;
  const basis = `/api/v1/deals/${encodeURIComponent(kontext.dealId)}/inventory`;

  async function nachher(meldung: string) {
    toast.success(meldung, { description: kontext.bearbeitbar ? "Der Entwurf rechnet neu." : "Gilt ab dem nächsten Entwurf; diese Version bleibt." });
    setForm(null);
    if (kontext.bearbeitbar) await kontext.neuRechnen();
    else await kontext.neuLaden();
  }

  async function schreiben(url: string, init: RequestInit, meldung: string) {
    setLaeuft(true);
    setFehler(null);
    const r = await apiAufruf<unknown>(url, init);
    setLaeuft(false);
    if (!r.ok) return setFehler(r.message);
    await nachher(meldung);
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.art === "aendern") {
      const menge = Number(form.menge);
      if (form.name.trim() === "") return setFehler("Name fehlt.");
      if (!Number.isInteger(menge) || menge < 1) return setFehler("Menge muss eine ganze Zahl ab 1 sein.");
      const body: Record<string, unknown> = { name: form.name.trim(), quantity: menge };
      if (form.groesse !== "") body.sizeClass = form.groesse;
      if (form.volumen.trim() !== "") body.volumeCbmPerPiece = form.volumen.trim().replace(",", ".");
      return schreiben(`${basis}/${encodeURIComponent(form.id)}`, jsonAufruf("PATCH", body), "Inventar korrigiert.");
    }
    if (form.art === "neu") {
      const menge = Number(form.menge || "1");
      if (form.name.trim() === "") return setFehler("Name fehlt.");
      if (!Number.isInteger(menge) || menge < 1) return setFehler("Menge muss eine ganze Zahl ab 1 sein.");
      return schreiben(`${basis}/add`, jsonAufruf("POST", { name: form.name.trim(), quantity: menge }), "Teil hinzugefügt.");
    }
    const minuten = Number(form.minuten);
    if (!Number.isInteger(minuten) || minuten < 1 || minuten > 600) return setFehler("Minuten: ganze Zahl von 1 bis 600.");
    if (form.grund.trim() === "") return setFehler("Bitte einen Grund angeben.");
    setLaeuft(true);
    const r = await kontext.uebersteuern([
      { art: "zeitposten", key: `teil.${form.key}`, wert: { bezeichnung: `${form.name}: Mehraufwand`, minuten }, grund: form.grund.trim() },
    ]);
    setLaeuft(false);
    if (!r.ok) return setFehler(r.message);
    toast.success("Mehraufwand gespeichert.");
    setForm(null);
  }

  async function entfernen(z: InventarListeZeile) {
    if (!z.id) return;
    if (!window.confirm(`„${z.name}“ aus dem Inventar entfernen? Das ändert die Lead-Daten.`)) return;
    await schreiben(`${basis}/${encodeURIComponent(z.id)}`, { method: "DELETE" }, "Teil entfernt.");
  }

  const formular = (z: InventarListeZeile | null) => {
    if (!form) return null;
    if (z && form.art === "aendern" && form.id === z.id) {
      const ohneKatalog = z.katalog !== null && !z.katalog.treffer;
      return (
        <form className="kalk-inv-form" onSubmit={(e) => void speichern(e)}>
          <label htmlFor={`${id}-n`}>
            Name
            <input id={`${id}-n`} className="lg-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label htmlFor={`${id}-m`}>
            Menge
            <input id={`${id}-m`} className="lg-input" inputMode="numeric" value={form.menge} onChange={(e) => setForm({ ...form, menge: e.target.value })} />
          </label>
          {ohneKatalog ? (
            <>
              <label htmlFor={`${id}-g`}>
                Größe
                <select id={`${id}-g`} className="lg-input" value={form.groesse} onChange={(e) => setForm({ ...form, groesse: e.target.value })}>
                  <option value="">unverändert</option>
                  {GROESSENKLASSEN.map((g) => (
                    <option key={g} value={g}>
                      {GROESSENKLASSE_TEXT[g]}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`${id}-v`}>
                m³ je Stück
                <input id={`${id}-v`} className="lg-input" inputMode="decimal" value={form.volumen} placeholder={z.volumenCbm !== null ? K2.format(z.volumenCbm) : ""} onChange={(e) => setForm({ ...form, volumen: e.target.value })} />
              </label>
            </>
          ) : null}
          <div className="kalk-inv-aktionen">
            <GlassButton type="button" variant="ghost" size="sm" onClick={() => setForm(null)} disabled={beschaeftigt}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" size="sm" disabled={beschaeftigt}>
              Speichern
            </GlassButton>
          </div>
        </form>
      );
    }
    if (z && form.art === "zeit" && form.key === z.key) {
      return (
        <form className="kalk-inv-form" onSubmit={(e) => void speichern(e)}>
          <label htmlFor={`${id}-z`}>
            Mehraufwand in min
            <input id={`${id}-z`} className="lg-input" inputMode="numeric" value={form.minuten} onChange={(e) => setForm({ ...form, minuten: e.target.value })} />
          </label>
          <label htmlFor={`${id}-zg`}>
            Grund (Pflicht)
            <input id={`${id}-zg`} className="lg-input" value={form.grund} placeholder="Etwa: Eckbank aus Massivholz, zu viert" onChange={(e) => setForm({ ...form, grund: e.target.value })} />
          </label>
          <div className="kalk-inv-aktionen">
            <GlassButton type="button" variant="ghost" size="sm" onClick={() => setForm(null)} disabled={beschaeftigt}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" size="sm" disabled={beschaeftigt}>
              Speichern
            </GlassButton>
          </div>
        </form>
      );
    }
    return null;
  };

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="kalk-liste-dialog">
        <GlassDialogTitle className="akte-dialog-titel">Inventar</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{liste.erklaerung}</GlassDialogDescription>
        {!kontext.bearbeitbar ? (
          <p className="kalk-dialog-hinweis">Korrekturen ändern die Lead-Daten und gelten ab dem nächsten Entwurf; diese Version bleibt.</p>
        ) : null}
        {montage ? (
          <MontageWahlListe zeilen={liste.zeilen} kontext={kontext} onFertig={() => setMontage(false)} />
        ) : (
        <>
        <ul className="kalk-inventar" aria-label="Inventarzeilen">
          {liste.zeilen.map((z, i) => (
            <li
              key={z.id ?? `${z.key}-${i}`}
              className="kalk-inv"
              data-ohne-katalog={z.katalog && !z.katalog.treffer ? "" : undefined}
              data-entfernt={!z.mitnehmen ? "" : undefined}
            >
              {z.fotoUrl ? <img className="kalk-inv-bild" src={z.fotoUrl} alt="" loading="lazy" /> : <span className="kalk-inv-bild" aria-hidden="true" />}
              <span>
                <span className="kalk-inv-name">
                  {z.menge > 1 ? `${G.format(z.menge)} × ` : ""}
                  {z.name}
                </span>{" "}
                <Herkunftsmarke art={z.korrigiert ? "MANUELL" : z.herkunft} text={z.korrigiert ? `VON HAND · ${z.korrigiert.von} ${z.korrigiert.am}` : z.herkunft === "MANUELL" ? "VON HAND" : z.herkunft} />
              </span>
              <span className="kalk-inv-aktionen">
                <GlassButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={beschaeftigt || !z.id}
                  onClick={() =>
                    setForm({ art: "aendern", id: z.id!, name: z.name, menge: String(z.menge), groesse: "", volumen: "" })
                  }
                >
                  Ändern
                </GlassButton>
                {z.mitnehmen ? (
                  <GlassButton type="button" variant="ghost" size="sm" disabled={beschaeftigt} onClick={() => setForm({ art: "zeit", key: z.key, name: z.name, minuten: "", grund: "" })}>
                    + Zeit
                  </GlassButton>
                ) : null}
                <GlassButton type="button" variant="ghost" size="sm" disabled={beschaeftigt || !z.id} onClick={() => void entfernen(z)}>
                  Entfernen
                </GlassButton>
              </span>
              <span className="kalk-inv-meta">
                {!z.mitnehmen ? <span>bleibt da</span> : null}
                {z.katalog ? <span>{z.katalog.treffer ? `Katalog: ${z.katalog.key ?? "Treffer"}` : "ohne Katalogtreffer, nach Größe geschätzt"}</span> : null}
                {z.groessenklasse ? <span>{GROESSENKLASSE_TEXT[z.groessenklasse]}</span> : null}
                {z.volumenCbm !== null ? <span>{K2.format(z.volumenCbm)} m³</span> : null}
                {z.gewichtKg !== null ? <span>{G.format(z.gewichtKg)} kg</span> : null}
                {z.trageMin !== null ? <span>Tragen {K2.format(z.trageMin)} min</span> : null}
                {z.katalog ? <span>{arbeitText("Demontage", z.demontage)}</span> : null}
                {z.katalog ? <span>{arbeitText("Montage", z.montage)}</span> : null}
                {z.montageGewaehlt ? <span className="kalk-inv-team">Demontage/Montage gewählt</span> : null}
                {z.mindestTraeger !== null ? (
                  <span className={z.bestimmtTeam ? "kalk-inv-team" : undefined}>
                    {z.mindestTraeger} {z.mindestTraeger === 1 ? "Träger" : "Träger"}
                    {z.bestimmtTeam ? ", bestimmt das Team" : ""}
                  </span>
                ) : null}
                {z.mehraufwandMin ? <span>+{G.format(z.mehraufwandMin)} min Mehraufwand</span> : null}
                {z.positionen > 1 ? <span>vom Rechner in {z.positionen} Teile geteilt</span> : null}
              </span>
              {formular(z)}
            </li>
          ))}
        </ul>
        {form?.art === "neu" ? (
          <form className="kalk-inv-form" onSubmit={(e) => void speichern(e)}>
            <label htmlFor={`${id}-nn`}>
              Name
              <input id={`${id}-nn`} className="lg-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label htmlFor={`${id}-nm`}>
              Menge
              <input id={`${id}-nm`} className="lg-input" inputMode="numeric" value={form.menge} onChange={(e) => setForm({ ...form, menge: e.target.value })} />
            </label>
            <div className="kalk-inv-aktionen">
              <GlassButton type="button" variant="ghost" size="sm" onClick={() => setForm(null)} disabled={beschaeftigt}>
                Abbrechen
              </GlassButton>
              <GlassButton type="submit" size="sm" disabled={beschaeftigt}>
                Hinzufügen
              </GlassButton>
            </div>
          </form>
        ) : null}
        {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
        <div className="akte-dialog-knoepfe">
          <GlassButton type="button" variant="ghost" disabled={beschaeftigt} onClick={() => setForm({ art: "neu", name: "", menge: "1" })}>
            + Teil hinzufügen
          </GlassButton>
          {onVolumen ? (
            <GlassButton type="button" variant="ghost" disabled={beschaeftigt} onClick={onVolumen}>
              Volumen vorgeben
            </GlassButton>
          ) : null}
          <GlassButton type="button" variant="ghost" disabled={beschaeftigt || !liste.zeilen.some((z) => z.mitnehmen && z.katalog)} onClick={() => setMontage(true)}>
            Demontage/Montage wählen
          </GlassButton>
          <GlassButton type="button" onClick={onSchliessen} disabled={beschaeftigt}>
            Fertig
          </GlassButton>
        </div>
        </>
        )}
      </GlassDialogContent>
    </GlassDialog>
  );
}
