"use client";

import "@/styles/neu-termin.css";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { DokumentDialog } from "@/components/neu/akte/dokument-dialog";
import { TerminDialogAlt } from "@/components/neu/akte/termin-dialog-alt";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { TagesRaster, TagesRasterZelle } from "@/lib/angebot-wahl";
import { euroText, tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import {
  ansichtLaden,
  dialogWaehlen,
  kalkulationLink,
  rasterLaden,
  sperrenUndKv,
  tageSpeichern,
  type DialogWahl,
  type KvTexte,
} from "./termin-ablauf";
import { TerminAuswahl } from "./termin-auswahl";
import {
  alsEmpfohlen,
  auswahlAusTagen,
  auswahlPruefen,
  empfehlungNormalisieren,
  empfohlenesPaketAus,
  monatBereich,
  monatErlaubt,
  monatVon,
  startMonat,
  tagAendern,
  tageAnbietenAus,
  tagKundenpreisCent,
  tagUmschalten,
  TERMIN_DIALOG_EVENT,
  type AuswahlTag,
  type TerminDialogEvent,
} from "./termin-logik";
import { TerminRaster, type MonatsStand } from "./termin-raster";

export { TERMIN_DIALOG_EVENT, terminDialogOeffnen, type TerminDialogEvent } from "./termin-logik";

function istEvent(x: unknown): x is TerminDialogEvent {
  return !!x && typeof x === "object" && typeof (x as TerminDialogEvent).dealId === "string";
}

/**
 * Hört auf `neu:termin-dialog-oeffnen` und zeigt den Termin-Dialog. Mit
 * `dealId` nur für diesen Deal. `onSchliessen` meldet, ob Tage gespeichert
 * wurden und in welcher Version (die Kalkulationsseite springt dorthin).
 */
export function TerminDialogEmpfaenger({
  dealId,
  onSchliessen,
}: {
  dealId?: string;
  onSchliessen?: (e: { geaendert: boolean; version: number | null }) => void;
}) {
  const portalZiel = usePortalZiel();
  const [offen, setOffen] = useState<TerminDialogEvent | null>(null);
  const gespeichert = useRef<number | null>(null);

  useEffect(() => {
    const bei = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!istEvent(d) || (dealId && d.dealId !== dealId)) return;
      gespeichert.current = null;
      setOffen({ dealId: d.dealId, version: typeof d.version === "number" ? d.version : null });
    };
    window.addEventListener(TERMIN_DIALOG_EVENT, bei);
    return () => window.removeEventListener(TERMIN_DIALOG_EVENT, bei);
  }, [dealId]);

  if (!offen) return null;
  return (
    <TerminDialog
      dealId={offen.dealId}
      version={offen.version ?? null}
      portalZiel={portalZiel}
      onGespeichert={(v) => {
        gespeichert.current = v;
      }}
      onSchliessen={() => {
        setOffen(null);
        onSchliessen?.({ geaendert: gespeichert.current !== null, version: gespeichert.current });
      }}
    />
  );
}

/**
 * Termin-Dialog (Plan 5b, Entscheidung 12). Prüft beim Öffnen, ob die Firma
 * Tagespreise hat und eine Version existiert (`ansicht.schalter`); sonst, im
 * Stundenmodus und bei jedem Ladefehler bleibt der alte Dialog
 * (`TerminDialogAlt`, Terminvorschläge ohne Preis). Ersetzt ihn in Akte,
 * Leads und Plan mit denselben Props.
 */
export function TerminDialog({
  dealId,
  version = null,
  portalZiel,
  onSchliessen,
  onGespeichert,
}: {
  dealId: string;
  version?: number | null;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  /** Tage gespeichert (in dieser Version, meist ein neuer Entwurf). */
  onGespeichert?: (version: number) => void;
}) {
  const [wahl, setWahl] = useState<DialogWahl | null>(null);

  useEffect(() => {
    let aktuell = true;
    setWahl(null);
    void dialogWaehlen(dealId, version).then((w) => {
      if (aktuell) setWahl(w);
    });
    return () => {
      aktuell = false;
    };
  }, [dealId, version]);

  if (wahl === null) {
    return (
      <GlassDialog open onOpenChange={(o) => !o && onSchliessen()}>
        <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="termin-dialog" data-laedt="">
          <GlassDialogTitle className="akte-dialog-titel">Termin</GlassDialogTitle>
          <GlassDialogDescription className="akte-dialog-text">Termine werden geladen …</GlassDialogDescription>
          <div className="termin-skelett" aria-busy="true">
            <span className="lg-skeleton" />
            <span className="lg-skeleton" />
          </div>
        </GlassDialogContent>
      </GlassDialog>
    );
  }
  if (wahl.art === "alt") return <TerminDialogAlt dealId={dealId} portalZiel={portalZiel} onSchliessen={onSchliessen} />;
  return (
    <TerminDialogNeu dealId={dealId} start={wahl.ansicht} portalZiel={portalZiel} onSchliessen={onSchliessen} onGespeichert={onGespeichert} />
  );
}

type Schritt =
  | { art: "waehlen" }
  | { art: "sperren"; ansicht: KalkulationsAnsicht }
  | { art: "gespeichert"; ansicht: KalkulationsAnsicht | null; version: number; text: string }
  | { art: "kottke"; ansicht: KalkulationsAnsicht };

/** Darf der Dialog nach dem Speichern sperren bzw. den KV erstellen? */
function sperrSchritt(a: KalkulationsAnsicht): boolean {
  return a.version.status === "entwurf" ? a.version.sperrbar : a.version.kvErstellbar;
}

function TerminDialogNeu({
  dealId,
  start,
  portalZiel,
  onSchliessen,
  onGespeichert,
}: {
  dealId: string;
  start: KalkulationsAnsicht;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onGespeichert?: (version: number) => void;
}) {
  const [heute] = useState(() => berlinDateString());
  // Mit Paketen gelten Preis und Anpassung dem empfohlenen Paket am Tag (wie das Raster).
  const paket = empfohlenesPaketAus(start.pakete);
  const paketName = paket ? start.pakete.find((p) => p.slug === paket)?.name ?? paket : null;
  const [auswahl, setAuswahl] = useState<AuswahlTag[]>(() => auswahlAusTagen(start.tage, heute, paket));
  const [monat, setMonat] = useState(() => startMonat(auswahl, null, heute));
  const [zellen, setZellen] = useState<Record<string, TagesRasterZelle>>({});
  const [staende, setStaende] = useState<Record<string, MonatsStand>>({});
  const [kopf, setKopf] = useState<Pick<TagesRaster, "wunschtermin" | "hinweis"> | null>(null);
  const [offenerTag, setOffenerTag] = useState<string | null>(null);
  const [klickFehler, setKlickFehler] = useState<string | null>(null);
  const [pruefFehler, setPruefFehler] = useState<string[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [schritt, setSchritt] = useState<Schritt>({ art: "waehlen" });
  const gesprungen = useRef(false);
  const versionNr = start.version.nummer;

  const monatLaden = useCallback(
    (m: string) => {
      const bereich = monatBereich(m, heute);
      if (!bereich) return;
      setStaende((s) => ({ ...s, [m]: { art: "laedt" } }));
      void rasterLaden(dealId, versionNr, bereich.von, bereich.bis).then((r) => {
        if (!r.ok) {
          setStaende((s) => ({ ...s, [m]: { art: "fehler", message: r.message } }));
          return;
        }
        setZellen((z) => {
          const neu = { ...z };
          for (const c of r.data.zellen) neu[c.datum] = c;
          return neu;
        });
        setKopf((k) => k ?? { wunschtermin: r.data.wunschtermin, hinweis: r.data.hinweis });
        setStaende((s) => ({ ...s, [m]: { art: "fertig" } }));
      });
    },
    [dealId, versionNr, heute]
  );

  // Jeder Monat wird einmal geladen; Fehler erst nach „Erneut laden“ noch einmal.
  useEffect(() => {
    if (staende[monat] === undefined) monatLaden(monat);
  }, [monat, staende, monatLaden]);

  // Gewählte Tage aus anderen Monaten (schon angeboten) brauchen ihren Preis auch.
  useEffect(() => {
    for (const m of new Set(auswahl.map((t) => monatVon(t.datum)))) {
      if (staende[m] === undefined && monatErlaubt(m, heute)) monatLaden(m);
    }
  }, [auswahl, staende, heute, monatLaden]);

  // Ohne Auswahl einmal zum Wunschtermin springen, wenn er in einem späteren Monat liegt.
  useEffect(() => {
    if (gesprungen.current || !kopf) return;
    gesprungen.current = true;
    if (auswahl.length > 0) return;
    const ziel = startMonat([], kopf.wunschtermin.datum, heute);
    if (ziel !== monat) setMonat(ziel);
  }, [kopf, auswahl.length, heute, monat]);

  // Jede Änderung an der Auswahl nimmt die alten Prüffehler weg (sie gelten dem alten Stand).
  useEffect(() => {
    setPruefFehler([]);
  }, [auswahl]);

  const beschaeftigt = laeuft || schritt.art !== "waehlen";

  function tagKlick(datum: string) {
    const r = tagUmschalten(auswahl, datum, heute);
    setAuswahl(r.auswahl);
    setKlickFehler(r.fehler);
  }

  async function anbieten() {
    const fehler = auswahlPruefen(auswahl, heute);
    setPruefFehler(fehler);
    if (fehler.length > 0) return;
    setLaeuft(true);
    try {
      const r = await tageSpeichern(dealId, versionNr, tageAnbietenAus(auswahl, paket));
      if (!r.ok) {
        setPruefFehler([r.message]);
        toast.error("Tage konnten nicht gespeichert werden.", { description: r.message });
        return;
      }
      const v = r.data.version;
      onGespeichert?.(v);
      const a = await ansichtLaden(dealId, v);
      if (!a.ok) {
        setSchritt({ art: "gespeichert", ansicht: null, version: v, text: `Die Tage stehen im Entwurf v${v}. ${a.message}` });
        return;
      }
      if (sperrSchritt(a.data)) setSchritt({ art: "sperren", ansicht: a.data });
      else
        setSchritt({
          art: "gespeichert",
          ansicht: a.data,
          version: v,
          text: a.data.version.sperrGrund ?? `Die Tage stehen im Entwurf v${v}. Sperren geht gerade nicht.`,
        });
    } finally {
      setLaeuft(false);
    }
  }

  async function sperren(ansicht: KalkulationsAnsicht, texte: KvTexte) {
    setLaeuft(true);
    try {
      const nr = ansicht.version.nummer;
      const r = await sperrenUndKv(dealId, ansicht, texte);
      if (r.art === "fertig") {
        toast.success(ansicht.version.status === "entwurf" ? `Version v${nr} gesperrt, KV erstellt.` : "KV erstellt.", {
          description: r.fileName ?? undefined,
        });
        onSchliessen();
        return;
      }
      if (r.art === "kottke") {
        toast.success(`Version v${nr} gesperrt.`, { description: r.hinweis ?? undefined });
        setSchritt({ art: "kottke", ansicht });
        return;
      }
      if (r.art === "fehler" && r.schritt === "kv") {
        toast.error("Version gesperrt, aber der KV konnte nicht erstellt werden.", { description: r.message });
        setSchritt({ art: "gespeichert", ansicht, version: nr, text: `Version v${nr} ist gesperrt. Den KV erstellst du auf der Kalkulationsseite neu. ${r.message}` });
        return;
      }
      // Preis geändert oder Sperrgrund: neu laden und mit dem frischen Stand weiter.
      toast.error(r.art === "preis_geaendert" ? r.message : "Sperren fehlgeschlagen.", {
        description: r.art === "preis_geaendert" ? "Die Preise werden neu geladen." : r.message,
      });
      const a = await ansichtLaden(dealId, nr);
      if (a.ok && sperrSchritt(a.data)) setSchritt({ art: "sperren", ansicht: a.data });
      else
        setSchritt({
          art: "gespeichert",
          ansicht: a.ok ? a.data : ansicht,
          version: nr,
          text: (a.ok ? a.data.version.sperrGrund : null) ?? (r.art === "fehler" ? r.message : `Die Tage stehen im Entwurf v${nr}.`),
        });
    } finally {
      setLaeuft(false);
    }
  }

  if (schritt.art === "kottke") {
    return <DokumentDialog dealId={dealId} art="KV" altLink={schritt.ansicht.angebotsformularLink} portalZiel={portalZiel} onSchliessen={onSchliessen} />;
  }

  const titel = schritt.art === "sperren" ? sperrTitel(schritt.ansicht) : schritt.art === "gespeichert" ? "Tage gespeichert" : "Termin";

  return (
    <GlassDialog open onOpenChange={(o) => !o && !laeuft && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="termin-dialog" data-schritt={schritt.art}>
        <GlassDialogTitle className="akte-dialog-titel">{titel}</GlassDialogTitle>

        {schritt.art === "waehlen" ? (
          <>
            <GlassDialogDescription className="akte-dialog-text">
              Tage mit Preis anbieten. Der Kunde wählt im Portal, der Preis folgt seiner Wahl. Gerechnet aus Version v{versionNr}.
            </GlassDialogDescription>

            <Wunschtermin kopf={kopf} />
            {/* F16: nur der Dienst weiß, ob die Marge übersteuert ist (`marge.gewaehltProzent` ist auch ohne Anpassung gefüllt). */}
            {kopf?.hinweis ? (
              <p className="termin-band" data-ton="gold" role="note">
                {kopf.hinweis}
              </p>
            ) : null}
            {paketName ? (
              <p className="termin-hilfe">Preise je Tag für {paketName} (empfohlenes Paket). Eine Anpassung gilt {paketName} an diesem Tag.</p>
            ) : null}

            <div className="termin-koerper">
              <div className="termin-links">
                <TerminRaster
                  monat={monat}
                  heute={heute}
                  zellen={zellen}
                  stand={staende[monat]}
                  auswahl={auswahl}
                  wunsch={{ datum: kopf?.wunschtermin.datum ?? null, weitere: kopf?.wunschtermin.weitere ?? [] }}
                  offenerTag={offenerTag}
                  gesperrt={beschaeftigt}
                  onMonat={(m) => {
                    setOffenerTag(null);
                    setMonat(m);
                  }}
                  onTag={tagKlick}
                  onAuftraege={setOffenerTag}
                  onNeuLaden={() => monatLaden(monat)}
                />
                {klickFehler ? (
                  <p className="termin-band" data-ton="gold" role="status">
                    {klickFehler}
                  </p>
                ) : null}
              </div>
              <div className="termin-rechts">
                <TerminAuswahl
                  auswahl={auswahl}
                  zellen={zellen}
                  gesperrt={beschaeftigt}
                  onAendern={(datum, f) => setAuswahl((a) => tagAendern(a, datum, f))}
                  onEmpfehlen={(datum) => setAuswahl((a) => alsEmpfohlen(a, datum))}
                  onEntfernen={(datum) => {
                    setAuswahl((a) => empfehlungNormalisieren(a.filter((t) => t.datum !== datum)));
                    setKlickFehler(null);
                  }}
                />
              </div>
            </div>

            {pruefFehler.length > 0 ? (
              <ul className="termin-fehler" role="alert">
                {pruefFehler.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}

            <div className="termin-fuss">
              <p className="termin-hilfe">
                Speichert die Tage im Entwurf. Danach sperrst du die Version und erstellst den KV; erst dann sieht der Kunde die Tage.
              </p>
              <div className="akte-dialog-knoepfe">
                <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={laeuft}>
                  Abbrechen
                </GlassButton>
                <GlassButton type="button" onClick={() => void anbieten()} disabled={laeuft || auswahl.length === 0} aria-busy={laeuft || undefined}>
                  {laeuft ? "Speichert …" : auswahl.length === 1 ? "1 Tag anbieten" : auswahl.length > 1 ? `${auswahl.length} Tage anbieten` : "Tage anbieten"}
                </GlassButton>
              </div>
            </div>
          </>
        ) : null}

        {schritt.art === "sperren" ? (
          <SperrSchritt
            ansicht={schritt.ansicht}
            laeuft={laeuft}
            onSpaeter={onSchliessen}
            onSperren={(texte) => void sperren(schritt.ansicht, texte)}
            dealId={dealId}
          />
        ) : null}

        {schritt.art === "gespeichert" ? (
          <>
            <GlassDialogDescription className="akte-dialog-text">{schritt.text}</GlassDialogDescription>
            {schritt.ansicht ? <TageListe ansicht={schritt.ansicht} /> : null}
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen}>
                Schließen
              </GlassButton>
              <GlassButton asChild>
                <Link href={kalkulationLink(dealId, schritt.version)} onClick={onSchliessen}>
                  Kalkulation öffnen
                </Link>
              </GlassButton>
            </div>
          </>
        ) : null}
      </GlassDialogContent>
    </GlassDialog>
  );
}

function sperrTitel(a: KalkulationsAnsicht): string {
  return a.version.status === "entwurf" ? `Version v${a.version.nummer} sperren und KV erstellen` : `KV zu Version v${a.version.nummer} erstellen`;
}

/** Oben im Dialog: Wunschtermin aus dem Deal oder dem Portal, weitere Wünsche (ohne „flexibel“, dafür gibt es kein Feld). */
function Wunschtermin({ kopf }: { kopf: Pick<TagesRaster, "wunschtermin"> | null }) {
  if (!kopf) return <p className="termin-wunsch" aria-busy="true">Wunschtermin wird geladen …</p>;
  const w = kopf.wunschtermin;
  const quelle = w.quelle === "portal" ? "aus dem Portal" : w.quelle === "deal" ? "aus dem Lead" : null;
  return (
    <p className="termin-wunsch">
      <span className="termin-wunsch-punkt" aria-hidden />
      {w.datum ? (
        <>
          Wunschtermin des Kunden: <b>{tagKurz(w.datum)}</b>
          {quelle ? <span className="termin-wunsch-quelle">{quelle}</span> : null}
        </>
      ) : (
        "Kein Wunschtermin bekannt."
      )}
      {w.weitere.length > 0 ? <span className="termin-wunsch-weitere">Weitere Wünsche: {w.weitere.map((d) => tagKurz(d)).join(", ")}</span> : null}
    </p>
  );
}

/** Die angebotenen Tage einer Version mit ihren Preisen (nach dem Speichern neu gerechnet). */
function TageListe({ ansicht }: { ansicht: KalkulationsAnsicht }) {
  if (ansicht.tage.length === 0) return null;
  // Wie im Raster: mit Paketen der Preis des empfohlenen Pakets am Tag.
  const paket = empfohlenesPaketAus(ansicht.pakete);
  return (
    <ul className="termin-uebersicht" aria-label="Angebotene Tage mit Preis">
      {ansicht.tage.map((t) => (
        <li key={t.datum} data-empfohlen={t.empfohlen || undefined}>
          <span>
            <b>{t.text || tagKurz(t.datum)}</b>
            {t.empfohlen ? <span className="termin-wahl-marke" data-ton="blau">empfohlen</span> : null}
            {(paket ? t.paketUebersteuert?.[paket] : t.uebersteuert) ? (
              <small>angepasst: {(paket ? t.paketUebersteuert?.[paket] : t.uebersteuert)?.grund}</small>
            ) : null}
          </span>
          <span className="termin-uebersicht-preis">
            {tagKundenpreisCent(t, paket) !== null ? euroText(tagKundenpreisCent(t, paket)!) : "kein Preis"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Zweiter Schritt nach „Tage anbieten“: die neu gerechneten Preise je Tag,
 * Anschreiben und Bemerkung (nicht bei Kottke, dort im nächsten Dialog), dann
 * sperren und KV erstellen wie auf der Kalkulationsseite. „Später“ lässt die
 * Tage im Entwurf.
 */
function SperrSchritt({
  ansicht,
  laeuft,
  dealId,
  onSpaeter,
  onSperren,
}: {
  ansicht: KalkulationsAnsicht;
  laeuft: boolean;
  dealId: string;
  onSpaeter: () => void;
  onSperren: (texte: KvTexte) => void;
}) {
  const id = useId();
  const [intro, setIntro] = useState("");
  const [remarks, setRemarks] = useState("");
  const kottke = ansicht.version.renderer === "vps";
  const entwurf = ansicht.version.status === "entwurf";

  function absenden(e: React.FormEvent) {
    e.preventDefault();
    const texte: KvTexte = {};
    if (!kottke && intro.trim()) texte.intro = intro.trim();
    if (!kottke && remarks.trim()) texte.remarks = remarks.trim();
    onSperren(texte);
  }

  return (
    <>
      <GlassDialogDescription className="akte-dialog-text">
        {entwurf
          ? `Die Tage stehen im Entwurf v${ansicht.version.nummer}, neu gerechnet. Beim Sperren werden alle Preise noch einmal geprüft; danach sieht der Kunde die Tage im Portal.`
          : "Der KV wird aus den gesperrten Preisen dieser Version erzeugt."}
      </GlassDialogDescription>
      <TageListe ansicht={ansicht} />
      {ansicht.kv ? (
        <p className="termin-kv-summe">
          <span>Im KV (empfohlener Tag)</span>
          <b>{euroText(ansicht.kv.summeCent)}</b>
        </p>
      ) : null}
      <form onSubmit={absenden}>
        {kottke ? (
          <p className="termin-hilfe">Anschreiben und Bemerkung gibst du im nächsten Dialog ein.</p>
        ) : (
          <>
            <label className="akte-dialog-feld" htmlFor={`${id}-intro`}>
              Anschreiben (optional)
              <textarea id={`${id}-intro`} className="lg-input lg-textarea" rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} />
            </label>
            <label className="akte-dialog-feld" htmlFor={`${id}-remarks`}>
              Bemerkung (optional)
              <textarea id={`${id}-remarks`} className="lg-input lg-textarea" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
          </>
        )}
        <div className="akte-dialog-knoepfe">
          <GlassButton asChild variant="ghost">
            <Link href={kalkulationLink(dealId, ansicht.version.nummer)} onClick={onSpaeter}>
              Kalkulation ansehen
            </Link>
          </GlassButton>
          <GlassButton type="button" variant="ghost" onClick={onSpaeter} disabled={laeuft}>
            Später
          </GlassButton>
          <GlassButton type="submit" disabled={laeuft} aria-busy={laeuft || undefined}>
            {laeuft ? "Läuft …" : entwurf ? "Sperren und KV erstellen" : "KV erstellen"}
          </GlassButton>
        </div>
      </form>
    </>
  );
}
