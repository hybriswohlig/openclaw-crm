"use client";

import "@/styles/neu-angebot-aendern.css";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import { euro } from "@/components/neu/akte/format";
import type { Vergleich } from "@/lib/angebot-vergleich";
import type { AnsichtsVorschlag } from "@/services/angebot-aenderung";
import { aenderungsUrl, fotoHinweis, QUELLE_TEXT, startAuswahl, type AenderungsDaten } from "./angebot-aendern-logik";
import { INVENTAR_OEFFNEN_EVENT } from "./annahmen-kasten";

type Antwort = { ergebnis: { hinweis?: string | null } | null; ansicht: AenderungsDaten };

const ZAHL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : null);

/** Lädt den Stand von „Angebot ändern“ (nur lesen). */
export async function aenderungLaden(dealId: string): Promise<AenderungsDaten | null> {
  const r = await apiAufruf<AenderungsDaten>(aenderungsUrl(dealId));
  return r.ok ? r.data : null;
}

/** Startet die Änderung (Entwurf aus der maßgeblichen Version). */
export async function aenderungStarten(dealId: string): Promise<ApiAntwort<{ ergebnis: { entwurfVersion: number; neu: boolean }; ansicht: AenderungsDaten }>> {
  return apiAufruf(aenderungsUrl(dealId), jsonAufruf("POST", {}));
}

function Marke({ quelle }: { quelle: keyof typeof QUELLE_TEXT }) {
  return (
    <span className="aa-marke" data-quelle={quelle}>
      {QUELLE_TEXT[quelle]}
    </span>
  );
}

/**
 * Panel „Angebot ändern“ (Plan 16): Quellen (Chat, Eingabe mit Verlauf, neue Fotos), die
 * Vorschlagsliste zum Abhaken, Übernehmen mit Rückfrage bei Lead-Änderungen, der Vergleich
 * alt ↔ neu und, nach dem Sperren, der Entwurf der Nachricht an den Kunden. Nichts geht
 * ohne Klick ins Angebot; Senden läuft über die Akte (nie automatisch).
 */
export function AngebotAendernPanel({
  dealId,
  daten: start,
  portalZiel,
  onSchliessen,
  onGeaendert,
}: {
  dealId: string;
  daten: AenderungsDaten;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  /** Nach Übernehmen oder Verwerfen: die Kalkulation neu laden (Entwurf hat neu gerechnet). */
  onGeaendert: (d: AenderungsDaten) => Promise<void> | void;
}) {
  const id = useId();
  const [daten, setDaten] = useState(start);
  const [auswahl, setAuswahl] = useState<Set<string>>(() => startAuswahl(start.vorschlaege));
  const [text, setText] = useState("");
  const [laeuft, setLaeuft] = useState<null | "chat" | "eingabe" | "uebernehmen" | "verwerfen" | "laden">(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [rueckfrage, setRueckfrage] = useState<{ art: "uebernehmen" | "verwerfen"; lead: string[]; ids: string[] } | null>(null);
  const [erledigtZeigen, setErledigtZeigen] = useState(false);

  // Neue Vorschläge kommen angehakt dazu; erledigte fallen aus der Auswahl.
  const schluessel = daten.vorschlaege.map((v) => `${v.id}:${v.status}`).join("|");
  useEffect(() => {
    setAuswahl((alt) => {
      const offen = new Set(daten.vorschlaege.filter((v) => v.status === "offen").map((v) => v.id));
      const neu = new Set([...alt].filter((x) => offen.has(x)));
      const vorher = new Set(alt);
      for (const x of startAuswahl(daten.vorschlaege)) if (!vorher.has(x)) neu.add(x);
      return neu;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel]);

  const offen = useMemo(() => daten.vorschlaege.filter((v) => v.status === "offen"), [daten]);
  const erledigt = useMemo(() => daten.vorschlaege.filter((v) => v.status !== "offen"), [daten]);
  const gewaehlt = offen.filter((v) => auswahl.has(v.id));
  const entwurf = daten.vorgang?.status === "entwurf";
  const beschaeftigt = laeuft !== null;
  const fotos = fotoHinweis(daten.fotos);

  async function aufruf(art: NonNullable<typeof laeuft>, pfad: string, body: unknown, nachher = false): Promise<boolean> {
    setLaeuft(art);
    setFehler(null);
    setHinweis(null);
    const r = await apiAufruf<Antwort>(aenderungsUrl(dealId, pfad), jsonAufruf("POST", body));
    setLaeuft(null);
    if (!r.ok) {
      const lead = (r.fehler?.details as { lead?: string[] } | undefined)?.lead;
      if (r.code === "LEAD_RUECKFRAGE" && lead && (art === "uebernehmen" || art === "verwerfen")) {
        setRueckfrage({ art, lead, ids: (body as { ids: string[] }).ids });
        return false;
      }
      setFehler(r.message);
      return false;
    }
    setDaten(r.data.ansicht);
    if (r.data.ergebnis?.hinweis) setHinweis(r.data.ergebnis.hinweis);
    if (nachher) await onGeaendert(r.data.ansicht);
    return true;
  }

  async function neuLaden() {
    setLaeuft("laden");
    const r = await apiAufruf<AenderungsDaten>(aenderungsUrl(dealId));
    setLaeuft(null);
    if (r.ok) setDaten(r.data);
    else setFehler(r.message);
  }

  async function uebernehmen(ids: string[], leadBestaetigt = false) {
    setRueckfrage(null);
    if (await aufruf("uebernehmen", "/uebernehmen", { ids, leadBestaetigt }, true)) {
      toast.success(ids.length === 1 ? "Änderung übernommen." : `${ids.length} Änderungen übernommen.`, { description: "Der Entwurf hat neu gerechnet." });
    }
  }

  async function verwerfen(ids: string[], leadBestaetigt = false) {
    setRueckfrage(null);
    await aufruf("verwerfen", "/verwerfen", { ids, leadBestaetigt }, true);
  }

  async function eingabe(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await aufruf("eingabe", "/eingabe", { text })) setText("");
  }

  const basis = daten.basis;
  return (
    <GlassDialog open onOpenChange={(o) => !o && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="aa-dialog">
        <GlassDialogTitle className="akte-dialog-titel">Angebot ändern</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Änderungen kommen als Vorschläge. Erst was du abhakst und übernimmst, landet im Entwurf; das verschickte Angebot bleibt, bis du die neue Version sperrst.
        </GlassDialogDescription>
        <p className="aa-kopf">
          {basis ? (
            <span className="aa-pille">
              v{basis.version} · {basis.preisCent !== null ? euro(basis.preisCent) : "ohne Preis"}
              {basis.verschickt ? " · verschickt" : ""}
              {basis.angenommen ? " · angenommen" : ""}
            </span>
          ) : null}
          <span aria-hidden="true">→</span>
          {daten.vorgang ? (
            <span className="aa-pille">
              v{daten.vorgang.version} {entwurf ? "Entwurf" : "gesperrt"} · {daten.vorgang.preisCent !== null ? euro(daten.vorgang.preisCent) : "rechnet"}
            </span>
          ) : null}
        </p>
        {basis?.angenommen && entwurf ? (
          <p className="kalk-band" role="status">
            <span>Der Kunde hat v{basis.version} schon angenommen. Das geänderte Angebot muss er neu annehmen; Termin und Reservierung bleiben, AB und Rechnung ändern sich nicht von selbst.</span>
          </p>
        ) : null}
        {fotos && entwurf ? (
          <p className="kalk-band" role="status">
            <span>{fotos} Neue Teile erscheinen hier, sobald die Auswertung fertig ist.</span>
            <button type="button" className="kalk-kleinknopf" disabled={beschaeftigt} onClick={() => void neuLaden()}>
              {laeuft === "laden" ? "Lädt …" : "Neu laden"}
            </button>
          </p>
        ) : null}

        <div className="aa-raster">
          <div className="aa-block" aria-label="Änderungen">
            {entwurf ? (
              <>
                <h3>Woher</h3>
                <div className="aa-quellen">
                  <GlassButton type="button" size="sm" variant="ghost" disabled={beschaeftigt} onClick={() => void aufruf("chat", "/chat", {})}>
                    {laeuft === "chat" ? "Liest den Chat …" : "Aus dem Chat"}
                  </GlassButton>
                  <span className="aa-unter">
                    {daten.chat.seit ? `Nachrichten des Kunden seit ${datum(daten.chat.seit)}` : "Nachrichten des Kunden"}
                    {daten.fotos.neu > 0 ? ` · ${daten.fotos.neu} neue Foto-Teile` : ""}
                  </span>
                </div>
                {daten.verlauf.length > 0 ? (
                  <ul className="aa-verlauf" aria-label="Bisherige Eingaben">
                    {daten.verlauf.map((v, i) => (
                      <li key={`${v.zeit}-${i}`}>{v.text}</li>
                    ))}
                  </ul>
                ) : null}
                <form className="aa-eingabe" onSubmit={(e) => void eingabe(e)}>
                  <label htmlFor={`${id}-t`} className="aa-unter">
                    Was soll sich ändern?
                    <textarea
                      id={`${id}-t`}
                      className="lg-input"
                      value={text}
                      maxLength={1000}
                      placeholder="Etwa: Fahrrad und 2 Kartons dazu, Bett und Schrank baut sie selbst auf, Halteverbot am Einzug weg"
                      onChange={(e) => setText(e.target.value)}
                      disabled={beschaeftigt}
                    />
                  </label>
                  <GlassButton type="submit" size="sm" disabled={beschaeftigt || !text.trim()}>
                    {laeuft === "eingabe" ? "Liest …" : daten.verlauf.length > 0 ? "Nachschärfen" : "Auswerten"}
                  </GlassButton>
                </form>
                <div className="aa-quellen">
                  <GlassButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={beschaeftigt}
                    onClick={() => {
                      // Inventar des Entwurfs öffnen (Teile ändern, entfernen, hinzufügen, Demontage/Montage wählen).
                      onSchliessen();
                      window.setTimeout(() => window.dispatchEvent(new Event(INVENTAR_OEFFNEN_EVENT)), 0);
                    }}
                  >
                    Von Hand bearbeiten
                  </GlassButton>
                  <span className="aa-unter">Inventar und Demontage/Montage direkt ändern. Zurück hierher über „Änderungen öffnen“ im blauen Band oben.</span>
                </div>
              </>
            ) : null}

            <h3>Vorschläge{offen.length > 0 ? ` (${offen.length} offen)` : ""}</h3>
            {offen.length === 0 ? <p className="aa-unter">{entwurf ? "Noch keine offenen Vorschläge." : "Keine offenen Vorschläge."}</p> : null}
            <ul className="aa-liste" aria-label="Offene Vorschläge">
              {offen.map((v) => (
                <VorschlagZeile
                  key={v.id}
                  v={v}
                  an={auswahl.has(v.id)}
                  gesperrt={beschaeftigt || !entwurf || v.aenderung.art === "unklar"}
                  onWechsel={(an) =>
                    setAuswahl((alt) => {
                      const n = new Set(alt);
                      if (an) n.add(v.id);
                      else n.delete(v.id);
                      return n;
                    })
                  }
                />
              ))}
            </ul>
            {rueckfrage ? (
              <div className="aa-rueckfrage" role="alertdialog" aria-label="Rückfrage Lead-Daten">
                <span>Das ändert die Lead-Daten (Inventar):</span>
                <ul>
                  {rueckfrage.lead.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <div className="aa-knoepfe">
                  <GlassButton type="button" size="sm" variant="ghost" onClick={() => setRueckfrage(null)}>
                    Abbrechen
                  </GlassButton>
                  <GlassButton
                    type="button"
                    size="sm"
                    onClick={() => void (rueckfrage.art === "uebernehmen" ? uebernehmen(rueckfrage.ids, true) : verwerfen(rueckfrage.ids, true))}
                  >
                    Ja, Lead ändern
                  </GlassButton>
                </div>
              </div>
            ) : null}
            {hinweis ? <p className="kalk-dialog-hinweis">{hinweis}</p> : null}
            {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
            {entwurf && offen.length > 0 ? (
              <div className="aa-knoepfe">
                <GlassButton type="button" size="sm" variant="ghost" disabled={beschaeftigt || gewaehlt.length === 0} onClick={() => void verwerfen(gewaehlt.map((v) => v.id))}>
                  {laeuft === "verwerfen" ? "Verwirft …" : "Verwerfen"}
                </GlassButton>
                <GlassButton type="button" size="sm" disabled={beschaeftigt || gewaehlt.length === 0} onClick={() => void uebernehmen(gewaehlt.map((v) => v.id))}>
                  {laeuft === "uebernehmen" ? "Übernimmt und rechnet …" : `Übernehmen (${gewaehlt.length})`}
                </GlassButton>
              </div>
            ) : null}
            {erledigt.length > 0 ? (
              <>
                <button type="button" className="kalk-kleinknopf" aria-expanded={erledigtZeigen} onClick={() => setErledigtZeigen((x) => !x)}>
                  {erledigtZeigen ? "Erledigte ausblenden" : `Erledigt (${erledigt.length})`}
                </button>
                {erledigtZeigen ? (
                  <ul className="aa-liste" aria-label="Erledigte Vorschläge">
                    {erledigt.map((v) => (
                      <VorschlagZeile key={v.id} v={v} an={false} gesperrt onWechsel={() => {}} />
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="aa-block" aria-label="Vergleich">
            <h3>Alt und neu</h3>
            {daten.vergleich ? <VergleichAnsicht v={daten.vergleich} /> : <p className="aa-unter">Der Vergleich erscheint, sobald der Entwurf gerechnet hat.</p>}
            <Nachricht dealId={dealId} daten={daten} />
          </div>
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}

function VorschlagZeile({ v, an, gesperrt, onWechsel }: { v: AnsichtsVorschlag; an: boolean; gesperrt: boolean; onWechsel: (an: boolean) => void }) {
  const id = useId();
  return (
    <li className="aa-zeile" data-art={v.aenderung.art} data-status={v.status}>
      {v.status === "offen" ? (
        <input id={id} type="checkbox" checked={an} disabled={gesperrt} onChange={(e) => onWechsel(e.target.checked)} />
      ) : (
        <span className="aa-marke">{v.status === "uebernommen" ? "übernommen" : "verworfen"}</span>
      )}
      <label htmlFor={id} className="aa-text">
        {v.text}
      </label>
      {v.foto?.fotoUrl ? <img className="aa-bild" src={v.foto.fotoUrl} alt="" loading="lazy" /> : <Marke quelle={v.quelle} />}
      {v.zitat && v.aenderung.art !== "unklar" ? <span className="aa-zitat">„{v.zitat}“</span> : null}
      <span className="aa-meta">
        {v.foto?.fotoUrl ? <Marke quelle={v.quelle} /> : null}
        {v.lead ? <span>ändert das Inventar im Lead</span> : null}
        {v.foto ? <span>steht schon im Entwurf</span> : null}
        {v.foto?.dublette ? <span className="aa-warn">Dublette? Ähnlich wie „{v.foto.dublette}“</span> : null}
        {v.schonDa ? <span className="aa-warn">schon im Inventar ({v.schonDa} Stück), Übernehmen erhöht die Menge</span> : null}
        {v.aenderung.art === "unklar" ? <span className="aa-warn">nicht zuordenbar, bitte von Hand</span> : null}
        {v.aenderung.art === "termin" ? <span>nur Hinweis, bucht nichts um</span> : null}
      </span>
    </li>
  );
}

function Wert({ alt, neu }: { alt: string | null; neu: string | null }) {
  return (
    <>
      <td className="aa-alt">{alt ?? "–"}</td>
      <td className="aa-neu">{neu ?? "–"}</td>
    </>
  );
}

function Zahl({ titel, alt, neu, format }: { titel: string; alt: number | null; neu: number | null; format: (n: number) => string }) {
  const ton = alt !== null && neu !== null && neu !== alt ? (neu > alt ? "hoch" : "runter") : undefined;
  return (
    <div className="aa-zahl" data-ton={ton}>
      <span>{titel}</span>
      <b>
        {alt !== null ? format(alt) : "–"} → {neu !== null ? format(neu) : "–"}
      </b>
    </div>
  );
}

export function VergleichAnsicht({ v }: { v: Vergleich }) {
  return (
    <>
      <div className="aa-zahlen">
        <Zahl titel="Preis" alt={v.preisCent.alt} neu={v.preisCent.neu} format={(c) => euro(c)} />
        <Zahl titel="Marge" alt={v.margeProzent.alt} neu={v.margeProzent.neu} format={(p) => `${ZAHL.format(p)} %`} />
        <Zahl titel="Volumen" alt={v.volumenCbm.alt} neu={v.volumenCbm.neu} format={(m) => `${ZAHL.format(m)} m³`} />
        <Zahl titel="Team" alt={v.team.alt} neu={v.team.neu} format={(n) => `${n} Pers.`} />
        <Zahl titel="Personenstunden" alt={v.personenStunden.alt} neu={v.personenStunden.neu} format={(h) => `${ZAHL.format(h)} h`} />
      </div>
      {v.neuberechnung && (v.neuberechnung.zeilen.length > 0 || (v.neuberechnung.preisCent ?? 0) !== 0) ? (
        <div className="aa-neuberechnung" role="note">
          <b>
            Neuberechnung, nicht vom Kunden
            {v.neuberechnung.preisCent !== null && v.neuberechnung.preisCent !== 0
              ? `: ${v.neuberechnung.preisCent > 0 ? "+" : "−"}${euro(Math.abs(v.neuberechnung.preisCent))}`
              : ""}
          </b>
          {v.neuberechnung.zeilen.length > 0 ? (
            <span>{v.neuberechnung.zeilen.map((z) => `${z.text} ${z.alt ?? "·"} → ${z.neu ?? "·"}`).join(" · ")}</span>
          ) : null}
          {v.neuberechnung.preisCent !== null && v.preisCent.differenzCent !== null ? (
            <span>Durch Kundenänderungen: {v.preisCent.differenzCent - v.neuberechnung.preisCent >= 0 ? "+" : "−"}{euro(Math.abs(v.preisCent.differenzCent - v.neuberechnung.preisCent))}</span>
          ) : null}
        </div>
      ) : null}
      {v.zeilen.length > 0 ? (
        <table className="aa-vergleich">
          <thead>
            <tr>
              <th>Was</th>
              <th>v{v.altVersion}</th>
              <th>v{v.neuVersion}</th>
              <th>Herkunft</th>
            </tr>
          </thead>
          <tbody>
            {v.zeilen.map((z) => (
              <tr key={`${z.schluessel}-${z.text}`}>
                <td>{z.text}</td>
                <Wert alt={z.alt} neu={z.neu} />
                <td>
                  <Marke quelle={z.herkunft} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="aa-unter">Inhaltlich noch keine Änderung.</p>
      )}
    </>
  );
}

function Nachricht({ dealId, daten }: { dealId: string; daten: AenderungsDaten }) {
  const id = useId();
  const [text, setText] = useState(daten.nachricht?.text ?? "");
  useEffect(() => setText(daten.nachricht?.text ?? ""), [daten.nachricht?.text]);
  if (!daten.nachricht || !daten.vorgang) return null;
  const gesperrt = daten.vorgang.status === "gesperrt";
  return (
    <div className="aa-nachricht">
      <h3>Nachricht an den Kunden</h3>
      {!gesperrt ? <p className="aa-unter">Vorschau. Erst nach dem Sperren und mit dem neuen KV senden.</p> : null}
      {!daten.nachricht.link ? <p className="aa-unter">Es gibt noch keinen Status-Link; er entsteht beim Sperren.</p> : null}
      <label htmlFor={id} className="aa-unter">
        Entwurf zum Freigeben (Anrede wie im Portal der Firma)
        <textarea id={id} className="lg-input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {gesperrt ? (
        <div className="aa-knoepfe">
          <GlassButton
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard?.writeText(text).then(
                () => toast.success("Nachricht kopiert."),
                () => toast.error("Kopieren ging nicht.")
              )
            }
          >
            Kopieren
          </GlassButton>
          <GlassButton asChild size="sm">
            <Link
              href={`/app/leads/${encodeURIComponent(dealId)}?nachricht=angebot`}
              onClick={() => {
                try {
                  window.sessionStorage.setItem(`angebot-nachricht:${dealId}`, text);
                } catch {
                  // ohne Speicher holt die Akte den Entwurf selbst
                }
              }}
            >
              In der Akte senden
            </Link>
          </GlassButton>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Vor dem Sperren der geänderten Version (Plan 16, Bauteil 4 und Zusatz Fotos): Vergleich,
 * offene Vorschläge, Fotos in Auswertung und eine bestehende Annahme. Ist das alte Angebot
 * angenommen, braucht es den Haken (nur Admins), dann hebt das Sperren die Annahme auf.
 */
export function AenderungSperrenDialog({
  daten,
  portalZiel,
  laeuft,
  onAbbrechen,
  onWeiter,
}: {
  daten: AenderungsDaten;
  portalZiel: HTMLElement | undefined;
  laeuft: boolean;
  onAbbrechen: () => void;
  onWeiter: (opts: { annahmeAufheben: boolean }) => void;
}) {
  const id = useId();
  const [haken, setHaken] = useState(false);
  const angenommen = !!daten.basis?.angenommen;
  const fotos = fotoHinweis(daten.fotos);
  const offen = daten.vorschlaege.filter((v) => v.status === "offen" && v.quelle !== "foto").length;
  const fotoOffen = daten.vorschlaege.filter((v) => v.status === "offen" && v.quelle === "foto").length;
  const gesperrt = laeuft || (angenommen && (!haken || !daten.darfAnnahmeAufheben));
  return (
    <GlassDialog open onOpenChange={(o) => !o && !laeuft && onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="aa-dialog">
        <GlassDialogTitle className="akte-dialog-titel">Geändertes Angebot sperren</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          v{daten.vorgang?.version} ersetzt v{daten.basis?.version}. Das alte Angebot ist danach nicht mehr annehmbar; der Status-Link zeigt nur noch das neue.
        </GlassDialogDescription>
        {daten.vergleich ? <VergleichAnsicht v={daten.vergleich} /> : null}
        <ul className="aa-sperren-liste">
          {offen > 0 ? <li>{offen === 1 ? "1 Vorschlag ist noch offen" : `${offen} Vorschläge sind noch offen`} und kommt nicht ins Angebot.</li> : null}
          {fotoOffen > 0 ? <li>{fotoOffen === 1 ? "1 Teil aus neuen Fotos ist" : `${fotoOffen} Teile aus neuen Fotos sind`} im Angebot, ohne dass du es bestätigt hast.</li> : null}
          {fotos ? <li className="aa-warn">{fotos} Später erkannte Teile fehlen im Angebot.</li> : null}
        </ul>
        {angenommen ? (
          <div className="aa-rueckfrage" role="alert">
            <span>
              Der Kunde hat v{daten.basis?.version} schon angenommen. Sperren hebt diese Annahme auf; der Kunde muss das neue Angebot neu annehmen. Termin und Reservierung
              bleiben. AB und Rechnung werden nicht still geändert, bitte bei Bedarf neu erstellen. Eine ältere AB sieht der Kunde im Portal danach nicht mehr.
            </span>
            {daten.darfAnnahmeAufheben ? (
              <label htmlFor={id} className="aa-haken">
                <input id={id} type="checkbox" checked={haken} onChange={(e) => setHaken(e.target.checked)} />
                Annahme aufheben, der Kunde nimmt neu an
              </label>
            ) : (
              <span>Das darf nur ein Admin.</span>
            )}
          </div>
        ) : null}
        <div className="akte-dialog-knoepfe">
          <GlassButton type="button" variant="ghost" disabled={laeuft} onClick={onAbbrechen}>
            Abbrechen
          </GlassButton>
          <GlassButton type="button" disabled={gesperrt} onClick={() => onWeiter({ annahmeAufheben: angenommen && haken })}>
            Weiter zum KV
          </GlassButton>
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
