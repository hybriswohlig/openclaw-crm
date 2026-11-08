"use client";

import "@/styles/neu-einsatz.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { euroText, tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import { BUCHUNG_MAX_AUFTRAEGE, EINSATZ_FEHLER_TEXT, pruefeBuchung, type BuchungEingabe } from "@/lib/einsatz";
import type { LeadFirma } from "@/lib/leads-board";
import type { PlanEintrag } from "@/lib/plan-heute";
import {
  buchungAendern,
  buchungAnlegen,
  buchungLaden,
  dealLoesen,
  dealZuordnen,
  stammdatenLaden,
  type BuchungVoll,
  type RechnerKlasse,
  type RechnerStation,
} from "./buchung-api";
import { kmVorschlag, mieteVorschlag } from "./buchung-logik";

const centAus = (t: string): number | null => {
  const s = t.trim().replace(/\./g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
};
const ganzAus = (t: string): number | null => {
  if (t.trim() === "") return null;
  const n = Number(t.trim());
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
};
const euroFeld = (cent: number | null) => (cent === null ? "" : (cent / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }));

/**
 * „Transporter mieten“ (12b Entscheidung 2) und Ansicht einer Buchung mit
 * Zuordnen, Lösen, Ändern und Stornieren (Entscheidung 3, 7). Schreibt nur
 * nach Klick; Warnungen kommen vom Server und erscheinen gold. Kein Preis
 * eines Kunden ändert sich durch diesen Dialog.
 */
export function BuchungDialog({
  modus,
  firmen,
  eintraege = [],
  portalZiel,
  onSchliessen,
  onGeaendert,
}: {
  modus: { art: "neu"; von?: string; firmaId?: string | null } | { art: "ansehen"; buchung: { id: string; von: string; bis: string } };
  firmen: readonly LeadFirma[];
  /** Geladene Plan-Einträge (für „Auftrag zuordnen“: Umzüge derselben Firma im Zeitraum). */
  eintraege?: readonly PlanEintrag[];
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onGeaendert?: () => void;
}) {
  const heute = berlinDateString();
  const [stamm, setStamm] = useState<{ stationen: RechnerStation[]; klassen: RechnerKlasse[] } | { fehler: string } | null>(null);
  const [voll, setVoll] = useState<BuchungVoll | null | "laedt">(modus.art === "ansehen" ? "laedt" : null);
  const [warnungen, setWarnungen] = useState<string[]>([]);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [stornoFrage, setStornoFrage] = useState(false);

  const start = modus.art === "neu" ? modus.von ?? heute : heute;
  const [f, setF] = useState({
    firmaId: modus.art === "neu" ? modus.firmaId ?? (firmen.length === 1 ? firmen[0]!.id : "") : "",
    von: start,
    bis: start,
    stationId: "",
    klasseId: "",
    miete: "",
    mieteVonHand: false,
    inklusivKm: "",
    kmVonHand: false,
    mehrkm: "",
    geplant: "1",
    notiz: "",
  });

  useEffect(() => {
    void stammdatenLaden().then((r) => setStamm(r.ok ? r.data : { fehler: r.message }));
  }, []);

  const neuLaden = async () => {
    if (modus.art !== "ansehen") return;
    const r = await buchungLaden(modus.buchung);
    if (!r.ok) {
      toast.error("Buchung nicht geladen.", { description: r.message });
      setVoll(null);
      return;
    }
    setVoll(r.data);
    if (r.data) {
      setWarnungen(r.data.warnungen);
      setF((x) => ({
        ...x,
        firmaId: r.data!.firmaId,
        von: r.data!.von,
        bis: r.data!.bis,
        stationId: r.data!.stationId,
        klasseId: r.data!.klasseId,
        miete: euroFeld(r.data!.mieteCent),
        mieteVonHand: true,
        inklusivKm: r.data!.inklusivKm === null ? "" : String(r.data!.inklusivKm),
        kmVonHand: true,
        mehrkm: euroFeld(r.data!.mehrkmSatzCent),
        geplant: String(r.data!.geplanteAuftraege),
        notiz: r.data!.notiz ?? "",
      }));
    }
  };
  useEffect(() => {
    void neuLaden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stationen = stamm && "stationen" in stamm ? stamm.stationen.filter((s) => s.aktiv || s.id === f.stationId) : [];
  const station = stationen.find((s) => s.id === f.stationId) ?? null;
  const klassen = stamm && "klassen" in stamm
    ? stamm.klassen.filter((k) => k.typ === "transporter" && (k.aktiv || k.id === f.klasseId) && (!station || k.anbieter === station.anbieter))
    : [];
  const klasse = klassen.find((k) => k.id === f.klasseId) ?? null;

  // Vorschläge aus den Klassenwerten, solange niemand von Hand eingetragen hat (E5: nur Vorschlag).
  useEffect(() => {
    setF((x) => {
      const m = !x.mieteVonHand ? mieteVorschlag(klasse, x.von, x.bis) : null;
      const km = !x.kmVonHand ? kmVorschlag(klasse, x.von, x.bis) : null;
      return {
        ...x,
        ...(m !== null ? { miete: euroFeld(m) } : {}),
        ...(km !== null ? { inklusivKm: String(km) } : {}),
        ...(x.mehrkm === "" && klasse?.mehrkilometerPreis != null ? { mehrkm: euroFeld(Math.round(klasse.mehrkilometerPreis * 100)) } : {}),
      };
    });
  }, [klasse, f.von, f.bis]);

  const eingabe: BuchungEingabe = {
    firmaId: f.firmaId,
    von: f.von,
    bis: f.bis,
    stationId: f.stationId,
    stationName: station?.name ?? (voll && voll !== "laedt" ? voll.stationName : ""),
    stationAnbieter: station?.anbieter ?? (voll && voll !== "laedt" ? voll.stationAnbieter : null),
    klasseId: f.klasseId,
    klasseName: klasse?.name ?? (voll && voll !== "laedt" ? voll.klasseName : ""),
    mieteCent: centAus(f.miete) ?? Number.NaN,
    inklusivKm: ganzAus(f.inklusivKm),
    mehrkmSatzCent: centAus(f.mehrkm),
    geplanteAuftraege: Number(f.geplant),
    notiz: f.notiz.trim() || null,
  };
  const fehler = pruefeBuchung(eingabe);

  async function speichern() {
    if (fehler) return;
    setLaeuft("speichern");
    if (modus.art === "neu") {
      const r = await buchungAnlegen(eingabe);
      setLaeuft(null);
      if (!r.ok) return void toast.error("Buchung nicht angelegt.", { description: r.message });
      toast.success("Transporter-Buchung angelegt.");
      onGeaendert?.();
      onSchliessen();
      return;
    }
    const { firmaId: _f, ...patch } = eingabe;
    const r = await buchungAendern(modus.buchung.id, patch);
    setLaeuft(null);
    if (!r.ok) return void toast.error("Änderung nicht gespeichert.", { description: r.message });
    toast.success("Buchung gespeichert.");
    setWarnungen(r.data.warnungen);
    onGeaendert?.();
    await neuLaden();
  }

  async function stornieren() {
    if (modus.art !== "ansehen") return;
    setLaeuft("storno");
    const r = await buchungAendern(modus.buchung.id, { status: "storniert" });
    setLaeuft(null);
    setStornoFrage(false);
    if (!r.ok) return void toast.error("Nicht storniert.", { description: r.message });
    toast.success("Buchung storniert.");
    setWarnungen(r.data.warnungen);
    onGeaendert?.();
    await neuLaden();
  }

  async function zuordnen(dealId: string) {
    if (modus.art !== "ansehen") return;
    setLaeuft(`zu:${dealId}`);
    const r = await dealZuordnen(modus.buchung.id, dealId);
    setLaeuft(null);
    if (!r.ok) return void toast.error("Nicht zugeordnet.", { description: r.message });
    setWarnungen(r.data.warnungen);
    onGeaendert?.();
    await neuLaden();
  }

  async function loesen(dealId: string) {
    if (modus.art !== "ansehen") return;
    setLaeuft(`weg:${dealId}`);
    const r = await dealLoesen(modus.buchung.id, dealId);
    setLaeuft(null);
    if (!r.ok) return void toast.error("Nicht gelöst.", { description: r.message });
    onGeaendert?.();
    await neuLaden();
  }

  const b = voll && voll !== "laedt" ? voll : null;
  const storniert = b?.status === "storniert";
  const kandidaten = useMemo(() => {
    if (!b) return [];
    const gesehen = new Set(b.zuordnungen.map((z) => z.dealId));
    const aus: PlanEintrag[] = [];
    for (const e of eintraege) {
      if (e.art !== "umzug" || e.ton === "grau" || e.ton === "violett") continue;
      if ((e.firma?.id ?? null) !== b.firmaId) continue;
      if (e.bisTag < b.von || e.tag > b.bis || gesehen.has(e.dealId)) continue;
      gesehen.add(e.dealId);
      aus.push(e);
    }
    return aus.sort((x, y) => x.tag.localeCompare(y.tag) || x.titel.localeCompare(y.titel, "de"));
  }, [b, eintraege]);

  const titel = modus.art === "neu" ? "Transporter mieten" : b ? `${b.klasseName} · ${b.stationName}` : "Buchung";
  const feld = (key: "miete" | "inklusivKm" | "mehrkm" | "geplant" | "notiz", hand?: "mieteVonHand" | "kmVonHand") => ({
    value: f[key],
    disabled: storniert,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [key]: e.target.value, ...(hand ? { [hand]: true } : {}) })),
  });

  return (
    <GlassDialog open onOpenChange={(o) => !o && laeuft === null && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="bu-dialog">
        <GlassDialogTitle className="akte-dialog-titel">{titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {modus.art === "neu"
            ? "Von Hand gemietet, je Firma. Station und Klasse aus dem Rechner, Miete und Kilometer wie im Mietvertrag."
            : b
              ? b.text
              : voll === "laedt"
                ? "Buchung wird geladen …"
                : "Buchung nicht gefunden."}
        </GlassDialogDescription>

        {warnungen.length > 0 ? (
          <ul className="ez-hinweise" aria-label="Warnungen">
            {warnungen.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        {stamm && "fehler" in stamm ? <p className="ma-fehler">Stationen und Klassen nicht erreichbar: {stamm.fehler}</p> : null}

        {modus.art === "neu" || b ? (
          <div className="ma-felder bu-felder">
            {modus.art === "neu" ? (
              <label className="ma-feld ma-feld-breit">
                <span>Firma</span>
                <select value={f.firmaId} onChange={(e) => setF((x) => ({ ...x, firmaId: e.target.value }))}>
                  <option value="">Firma wählen</option>
                  {firmen.map((fi) => (
                    <option key={fi.id} value={fi.id}>
                      {fi.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="ma-feld">
              <span>Von</span>
              <input type="date" value={f.von} disabled={storniert} onChange={(e) => setF((x) => ({ ...x, von: e.target.value, bis: x.bis < e.target.value ? e.target.value : x.bis }))} />
            </label>
            <label className="ma-feld">
              <span>Bis</span>
              <input type="date" value={f.bis} min={f.von} disabled={storniert} onChange={(e) => setF((x) => ({ ...x, bis: e.target.value }))} />
            </label>
            <label className="ma-feld">
              <span>Station</span>
              <select value={f.stationId} disabled={storniert} onChange={(e) => setF((x) => ({ ...x, stationId: e.target.value, klasseId: "" }))}>
                <option value="">{stamm ? "Station wählen" : "lädt …"}</option>
                {stationen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {b && !stationen.some((s) => s.id === b.stationId) ? <option value={b.stationId}>{b.stationName} (nicht mehr im Rechner)</option> : null}
              </select>
            </label>
            <label className="ma-feld">
              <span>Klasse</span>
              <select value={f.klasseId} disabled={storniert} onChange={(e) => setF((x) => ({ ...x, klasseId: e.target.value }))}>
                <option value="">{f.stationId ? "Klasse wählen" : "erst Station"}</option>
                {klassen.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
                {b && !klassen.some((k) => k.id === b.klasseId) ? <option value={b.klasseId}>{b.klasseName} (nicht mehr im Rechner)</option> : null}
              </select>
            </label>
            <label className="ma-feld">
              <span>Miete gesamt in €</span>
              <input type="text" inputMode="decimal" {...feld("miete", "mieteVonHand")} />
            </label>
            <label className="ma-feld">
              <span>Geplante Aufträge</span>
              <input type="number" min={1} max={BUCHUNG_MAX_AUFTRAEGE} {...feld("geplant")} />
            </label>
            <label className="ma-feld">
              <span>Kilometer inklusive</span>
              <input type="text" inputMode="numeric" placeholder="leer = unbegrenzt" {...feld("inklusivKm", "kmVonHand")} />
            </label>
            <label className="ma-feld">
              <span>Mehr-km je km in €</span>
              <input type="text" inputMode="decimal" placeholder="leer = Satz der Klasse" {...feld("mehrkm")} />
            </label>
            <label className="ma-feld ma-feld-breit">
              <span>Notiz</span>
              <input type="text" maxLength={300} {...feld("notiz")} />
            </label>
            <p className="ma-hinweis ma-feld-breit">
              Miete und Kilometer sind Vorschläge aus den Tagessätzen des Rechners. Anteil je Auftrag = Miete ÷ geplante Aufträge.
              {Number.isFinite(eingabe.mieteCent) && Number(f.geplant) >= 1
                ? ` Jetzt ${euroText(Math.ceil(eingabe.mieteCent / Number(f.geplant)))} je Auftrag.`
                : ""}
            </p>
          </div>
        ) : null}

        {fehler && (f.stationId || modus.art === "ansehen") ? <p className="ma-fehler">{EINSATZ_FEHLER_TEXT[fehler]}</p> : null}

        {b ? (
          <div className="ma-abschnitt">
            <div className="ma-abschnitt-kopf">
              <h3>Aufträge ({b.zuordnungen.length} von {b.geplanteAuftraege})</h3>
            </div>
            {b.zuordnungen.length === 0 ? <p className="ma-leer">Noch kein Auftrag zugeordnet.</p> : null}
            <ul className="ma-abw-liste">
              {b.zuordnungen.map((z) => (
                <li key={z.dealId} className="ma-abw bu-zeile">
                  <Link href={`/app/leads/${z.dealId}`} className="bu-link">
                    {z.titel}
                  </Link>
                  <span className="ma-abw-zeit">
                    {z.tag ? tagKurz(z.tag) : "ohne Termin"}
                    {z.geschaetzteKm !== null ? <small>ca. {z.geschaetzteKm} km</small> : null}
                  </span>
                  <button type="button" className="ez-link" disabled={laeuft !== null} onClick={() => void loesen(z.dealId)}>
                    Lösen
                  </button>
                </li>
              ))}
            </ul>
            {!storniert && kandidaten.length > 0 ? (
              <>
                <div className="ma-abschnitt-kopf bu-kopf-abstand">
                  <h3>Auftrag zuordnen</h3>
                </div>
                <ul className="ma-abw-liste">
                  {kandidaten.map((e) => (
                    <li key={e.dealId} className="ma-abw bu-zeile">
                      <span>
                        {e.titel}
                        <small className="bu-klein">{e.ton === "gestrichelt" ? "noch nicht fest" : "fest"}</small>
                      </span>
                      <span className="ma-abw-zeit">{tagKurz(e.tag)}</span>
                      <button type="button" className="ez-link" disabled={laeuft !== null} onClick={() => void zuordnen(e.dealId)}>
                        Zuordnen
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        {stornoFrage ? (
          <div className="ez-rueckfrage" role="alertdialog" aria-label="Rückfrage">
            <i aria-hidden="true" />
            <p>Buchung stornieren? Sie bleibt sichtbar. Gesendete Preise ändern sich nicht, der Plan warnt.</p>
            <div className="ez-rueckfrage-knoepfe">
              <GlassButton type="button" size="sm" variant="ghost" onClick={() => setStornoFrage(false)}>
                Abbrechen
              </GlassButton>
              <GlassButton type="button" size="sm" onClick={() => void stornieren()} disabled={laeuft !== null}>
                Stornieren
              </GlassButton>
            </div>
          </div>
        ) : null}

        <div className="ez-fuss">
          <p>{storniert ? "Storniert. Nicht mehr änderbar." : "Gespeichert wird erst mit dem Knopf."}</p>
          {b && !storniert && !stornoFrage ? (
            <GlassButton type="button" variant="ghost" onClick={() => setStornoFrage(true)} disabled={laeuft !== null}>
              Stornieren …
            </GlassButton>
          ) : null}
          <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={laeuft !== null}>
            Schließen
          </GlassButton>
          {!storniert && (modus.art === "neu" || b) ? (
            <GlassButton type="button" onClick={() => void speichern()} disabled={!!fehler || laeuft !== null} aria-busy={laeuft === "speichern" || undefined}>
              {laeuft === "speichern" ? "Speichert …" : modus.art === "neu" ? "Buchung anlegen" : "Speichern"}
            </GlassButton>
          ) : null}
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
