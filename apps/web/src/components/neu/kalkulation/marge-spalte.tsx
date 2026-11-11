"use client";

import "@/styles/neu-kalk-marge.css";
import "@/styles/neu-kalkulation-5b.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { AngabenDialog } from "@/components/neu/akte/angaben-dialog";
import { DokumentDialog } from "@/components/neu/akte/dokument-dialog";
import { dokumentStart } from "@/components/neu/akte/dokument-start";
import type { LeadContext } from "@/lib/deal-doc-data";
import type { KvHinweisDaten, Vorpruefung } from "@/lib/kv-vorpruefung";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { euro } from "@/components/neu/akte/format";
import { AnpassungDialog, type AnpassungStart } from "./anpassung-dialog";
import { istPreisStart } from "./anpassung-start";
import { AnpassungenListe } from "./anpassungen-liste";
import type { KalkKontext, Lauf } from "./kalk-seite";
import { KvDialog, type KvTexte } from "./kv-dialog";
import { KernWarnung } from "./kern-warnung";
import { KvVorschau, PaketeAnzeige } from "./kv-vorschau";
import { PaketPreise, PreismodusWahl, TagePreise } from "./paket-preise";
import { ModuswechselDialog, PreisDialog } from "./preis-dialog";
import { OhneAdresseDialog } from "./adress-dialog";
import { HebelAusDialog } from "./hebel-aus-dialog";
import { PaketeSchalter } from "./pakete-schalter";
import { PaketeZeileKasten } from "@/components/neu/kv-danach/pakete-zeile";
import type { HebelArt } from "@/services/rechner/kv-posten";
import { ADRESSE_CHAT_TEXT, ADRESSE_FEHLT_TEXT } from "@/lib/kalkulation-p15";
import {
  sperrAusgang,
  sperrKoerper,
  tagespreiseKnopf,
  terminDialogOeffnen,
  type PreisStart,
  type TerminStart,
} from "./preis-logik";
import { StundenBlock } from "./stunden-ansicht";
import { MargeRegler } from "./marge-regler";
import { margeVorschau } from "./marge-vorschau";
import { uebersteuerbareZeilen } from "./selbstkosten-spalte";
import { SperrenBereich } from "./sperren-bereich";
import { ohneVerwaiste } from "./verwaist-logik";
import { VerwaisteAnpassungen } from "./verwaiste-anpassungen";

/** Speichern 800 ms nach dem letzten Reglerwert (Entscheidung 4). */
const REGLER_WARTEZEIT_MS = 800;
const REGLER_GRUND = "Marge im Regler gewählt";

const PROZENT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** „40 %“, „−3 %“, „±0“ */
export function punkteText(punkte: number): string {
  if (punkte === 0) return "±0";
  return `${punkte < 0 ? "−" : ""}${PROZENT.format(Math.abs(punkte))} %`;
}

/** „Preis = 1.533 € ÷ (1 − 0,38)“ und der ungerundete Preis für die Vorschau des Reglers. */
export function vorschauFormel(selbstkostenEur: number, prozent: number): { formel: string; rohText: string } {
  const ganz = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const faktor = (prozent / 100).toFixed(2).replace(".", ",");
  return {
    formel: `Preis = ${ganz.format(selbstkostenEur)} € ÷ (1 − ${faktor})`,
    rohText: `${ganz.format(selbstkostenEur / (1 - prozent / 100))} €`,
  };
}

type Dialog =
  | { art: "anpassung"; start: AnpassungStart }
  | { art: "preis"; start: PreisStart }
  | { art: "kv"; nurKv: boolean }
  | { art: "angaben"; nurKv: boolean; pruefung: Vorpruefung }
  | { art: "moduswechsel"; texte: KvTexte; meldung: string }
  | { art: "ohne_adresse"; texte: KvTexte; meldung: string; modusWechselBestaetigt: boolean }
  | { art: "hebel_aus"; hebel: HebelArt; posten: string }
  | { art: "kottke" };

/**
 * Rechte Spalte „Marge und Preis“ (Spec 3.6): Regler mit Vorschlag und
 * Gründen, Preisblock (Formel, Rundung, Gewinn, Listenpreis), „So steht es
 * im KV“, Paketpreise, Anpassungen und der Sperrbereich. Der Regler zeigt
 * beim Ziehen eine Vorschau über `margeVorschau` und speichert 800 ms nach
 * dem letzten Wert, nur wenn er vom gewählten abweicht (Entscheidung 4).
 * Sperren schickt den gesehenen Preis mit; 409 PREIS_GEAENDERT lädt neu.
 * Plan 5a: verwaiste Fahrzeug-Anpassungen stehen als goldene Zeilen über
 * der Liste (nicht doppelt darin), der KV-Zustand als Marke an der Vorschau.
 * Plan 5b (Firmen-Schalter „Angebot aus Kalkulation“): Preismodus,
 * Kern-Warnung, Paketpreise mit Anpassung, Stunden-KV und angebotene Tage;
 * Sperren schickt den Preis-Hash, ein Stunden-KV fragt vor dem Wechsel zum
 * Festpreis nach. Ohne Schalter alles wie vor 5b.
 */
export function MargeSpalte({ ansicht, kontext }: { ansicht: KalkulationsAnsicht; kontext: KalkKontext }) {
  const { marge, preis, version } = ansicht;
  const portalZiel = usePortalZiel();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  /** Plan 15: die Rückfrage „ohne Adresse“ gilt auch für eine folgende Moduswechsel-Rückfrage. */
  const ohneAdresseBisher = useRef(false);
  const basis = marge.gewaehltProzent ?? marge.vorschlagProzent ?? marge.min;
  /** Wert im Regler, solange er vom gespeicherten abweicht; null = folgt der Ansicht. */
  const [entwurf, setEntwurf] = useState<number | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Der noch nicht gespeicherte Reglerwert (für das Speichern beim Verlassen). */
  const ausstehend = useRef<number | null>(null);
  const beschaeftigt = kontext.laeuft !== null;
  const { setzeAusstehend, uebersteuern } = kontext;

  const speichern = useCallback(
    (prozent: number) => {
      ausstehend.current = null;
      setzeAusstehend(false);
      setSpeichert(true);
      void uebersteuern([{ art: "marge", key: "marge", wert: prozent, grund: REGLER_GRUND }]).then((r) => {
        setSpeichert(false);
        if (!r.ok) {
          toast.error("Marge konnte nicht gespeichert werden.", { description: r.message });
          setEntwurf(null);
        }
      });
    },
    [setzeAusstehend, uebersteuern]
  );

  // Neue Ansicht (nach dem Speichern oder Versionswechsel): Regler folgt wieder dem Server.
  useEffect(() => {
    setEntwurf(null);
    setSpeichert(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    ausstehend.current = null;
    setzeAusstehend(false);
  }, [kontext.versionNr, marge.gewaehltProzent, marge.vorschlagProzent, setzeAusstehend]);

  // Beim Verlassen der Seite innerhalb der 800 ms: nicht verwerfen, sondern sofort speichern (M3).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (ausstehend.current !== null) speichern(ausstehend.current);
    },
    [speichern]
  );

  /**
   * Regler bewegt: Vorschau sofort, speichern 800 ms nach dem letzten Wert und
   * nur bei Abweichung von der Basis. Solange ein Wert aussteht, gilt die Seite
   * als beschäftigt (Versionen, Sperren und KV-Dialog gesperrt), der Regler
   * selbst bleibt frei (I2, Review Focus 5).
   */
  function reglerWert(prozent: number) {
    setEntwurf(prozent);
    if (timer.current) clearTimeout(timer.current);
    if (prozent === basis) {
      ausstehend.current = null;
      setzeAusstehend(false);
      timer.current = setTimeout(() => {
        timer.current = null;
        setEntwurf(null);
      }, REGLER_WARTEZEIT_MS);
      return;
    }
    ausstehend.current = prozent;
    setzeAusstehend(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      speichern(prozent);
    }, REGLER_WARTEZEIT_MS);
  }

  const wert = entwurf ?? basis;
  const vorschau = entwurf !== null && entwurf !== basis ? margeVorschau(marge, entwurf) : null;
  const formel = vorschau ? vorschauFormel(marge.selbstkostenEur, wert) : null;
  /** Lauf für Sperrbereich und KV-Dialog: auch ein ausstehender Reglerwert sperrt sie. */
  const lauf: Lauf | null = kontext.laeuft ?? (kontext.ausstehend ? "speichern" : null);

  async function sperrenUndKv(texte: KvTexte, nurKv: boolean, modusWechselBestaetigt = false, ohneAdresseBestaetigt = false) {
    // Plan 15 (Bauteil 5): fehlt eine Adresse, erst nachfragen („Preis ohne echte Fahrzeiten“).
    const fehlt = ansicht.version.adresseFehlt;
    if (!nurKv && !ohneAdresseBestaetigt && (fehlt.beladen || fehlt.entladen)) {
      setDialog({ art: "ohne_adresse", texte, meldung: fehlt.ausChat ? ADRESSE_CHAT_TEXT : ADRESSE_FEHLT_TEXT, modusWechselBestaetigt });
      return;
    }
    const basisUrl = `/api/v1/deals/${encodeURIComponent(kontext.dealId)}/calculation/versions/${kontext.versionNr}`;
    kontext.setzeLauf("sperren");
    try {
      if (!nurKv) {
        const sperre = await apiAufruf<{ version: { version: number } }>(
          `${basisUrl}/lock`,
          jsonAufruf("POST", sperrKoerper(ansicht, { modusWechselBestaetigt, ohneAdresseBestaetigt }))
        );
        const ausgang = sperrAusgang(sperre);
        if (ausgang.art === "adresse_fehlt" && !ohneAdresseBestaetigt) {
          setDialog({ art: "ohne_adresse", texte, meldung: ausgang.meldung, modusWechselBestaetigt });
          return;
        }
        if (ausgang.art === "moduswechsel" && !modusWechselBestaetigt) {
          // Nichts gesperrt: erst nachfragen, dann mit Bestätigung erneut (Entscheidung 5b-5).
          setDialog({ art: "moduswechsel", texte, meldung: ausgang.meldung });
          return;
        }
        if (ausgang.art !== "ok") {
          if (ausgang.art === "preis_geaendert") {
            toast.error(ausgang.meldung, { description: "Die Ansicht wird neu geladen." });
          } else {
            toast.error("Sperren fehlgeschlagen.", { description: ausgang.meldung });
          }
          setDialog(null);
          await kontext.neuLaden();
          return;
        }
      }
      const kv = await apiAufruf<{ renderer: "crm" | "vps"; document?: { id: string }; fileName?: string; hinweis?: string }>(
        `${basisUrl}/kv`,
        jsonAufruf("POST", { copy: texte })
      );
      if (!kv.ok) {
        toast.error(nurKv ? "KV konnte nicht erstellt werden." : "Version gesperrt, aber der KV konnte nicht erstellt werden.", {
          description: kv.message,
        });
        setDialog(null);
        await kontext.neuLaden();
        return;
      }
      if (kv.data.renderer === "vps") {
        toast.success(nurKv ? "KV wird erzeugt." : `Version v${kontext.versionNr} gesperrt.`, { description: kv.data.hinweis ?? undefined });
        setDialog({ art: "kottke" });
      } else {
        toast.success(nurKv ? "KV erstellt." : `Version v${kontext.versionNr} gesperrt, KV erstellt.`, {
          description: kv.data.fileName ?? undefined,
        });
        setDialog(null);
      }
      await kontext.neuLaden();
    } finally {
      kontext.setzeLauf(null);
    }
  }

  /**
   * Vorprüfung vor Sperren und KV, für Kottke und Ceylan (Review M3): fehlen Name,
   * Kundenanschrift, Einzug oder Datum, erst „Es fehlen noch Angaben“, dann der KV-Dialog.
   * Kann die Prüfung nicht laden, geht es wie bisher weiter (der Dokumentdialog prüft für Kottke noch einmal).
   */
  async function kvMitVorpruefung(nurKv: boolean) {
    const a = await apiAufruf<{ leadContext?: LeadContext | null; kvHinweise?: KvHinweisDaten | null }>(
      `/api/v1/deals/${encodeURIComponent(kontext.dealId)}/auftrag`
    );
    if (a.ok) {
      const start = dokumentStart(kontext.dealId, a.data?.leadContext ?? null, a.data?.kvHinweise ?? null, "KV");
      if (start.art === "angaben") return setDialog({ art: "angaben", nurKv, pruefung: start.pruefung });
    }
    setDialog({ art: "kv", nurKv });
  }

  const plan5 = ansicht.schalter.angebotAusKalkulation;
  // Entscheidung 7: Stunden-KV statt Festpreis. Marge, Formel und gerundeter Preis
  // gelten dann nicht (Sätze und Mindeststunden kommen aus den Rechner-Einstellungen).
  const stundenModus = plan5 && version.preisModus === "stunden";
  const tagesKnopf = tagespreiseKnopf(ansicht.schalter, version);
  const preisOeffnen = (start: PreisStart) => setDialog({ art: "preis", start });

  function anpassungOeffnen(start: AnpassungStart | PreisStart | TerminStart) {
    if (start.art === "termin") {
      if (tagesKnopf.aktiv) terminDialogOeffnen({ dealId: kontext.dealId, version: version.nummer });
      else toast.message("Tagespreise ändert der Termin-Dialog.", { description: tagesKnopf.hinweis ?? undefined });
      return;
    }
    if (istPreisStart(start)) setDialog({ art: "preis", start });
    else setDialog({ art: "anpassung", start });
  }

  // Die Dialoge stehen außerhalb des Glas-Panels: dessen backdrop-filter wäre
  // der Bezugsrahmen für den alten, nicht portalierten GenerateDocumentDialog.
  return (
    <>
    <GlassPanel variant="panel" className="kalk-panel" aria-label="Marge und Preis">
      <div className="kalk-panel-kopf">
        <div>
          <h2 className="kalk-panel-titel">Marge und Preis</h2>
          <p className="kalk-panel-unter">Was der Kunde zahlt.</p>
        </div>
      </div>

      {stundenModus ? null : (
        <>
          <div className="kalk-marge">
            <MargeRegler marge={marge} wert={wert} gesperrt={!kontext.bearbeitbar || beschaeftigt} speichert={speichert} onWert={reglerWert} />
            <ul className="kalk-gruende" aria-label="Gründe des Vorschlags">
              {marge.gruende.map((g, i) => (
                <li key={`${g.text}-${i}`}>
                  <span>{g.text}</span>
                  <b>{punkteText(g.punkte)}</b>
                </li>
              ))}
              {marge.gewaehltProzent !== null ? (
                <li data-gewaehlt="">
                  <span>{marge.gewaehltVon ? `Gewählt von ${marge.gewaehltVon}` : "Gewählt"}</span>
                  <b>{marge.gewaehltProzent} %</b>
                </li>
              ) : null}
            </ul>
          </div>

          <div className="kalk-preis">
            <div className="kalk-summe">
              <span>{formel ? formel.formel : preis.formel}</span>
              <span>{formel ? formel.rohText : (preis.preisRohText ?? "–")}</span>
            </div>
            <div className="kalk-ku">
              <span>gerundet auf {euro(marge.rundungEur * 100)}{vorschau ? " · Vorschau" : ""}</span>
              <span className="kalk-ku-a">{vorschau ? euro(vorschau.preisCent) : preis.gerundetCent !== null ? euro(preis.gerundetCent) : "–"}</span>
            </div>
            <div className="kalk-ku">
              <span>Gewinn</span>
              <span className="kalk-ku-a">{vorschau ? euro(vorschau.gewinnCent) : preis.gewinnCent !== null ? euro(preis.gewinnCent) : "–"}</span>
            </div>
            {preis.listenpreisCent !== null ? (
              <div className="kalk-ku">
                <span>Listenpreis zum Vergleich</span>
                <span className="kalk-ku-a">{euro(preis.listenpreisCent)}</span>
              </div>
            ) : null}
            {preis.spanne ? (
              <div className="kalk-ku">
                <span>Spanne der Schätzung</span>
                <span className="kalk-ku-a">
                  {euro(preis.spanne.vonCent)} bis {euro(preis.spanne.bisCent)}
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}

      {ansicht.paketSchalter ? <PaketeSchalter schalter={ansicht.paketSchalter} kontext={kontext} portalZiel={portalZiel} /> : null}
      {plan5 ? <PreismodusWahl modus={version.preisModus} beschaeftigt={lauf !== null} onPreis={preisOeffnen} /> : null}
      {stundenModus ? null : (
        <>
          <KvVorschau
            kv={ansicht.kv}
            kvFehler={ansicht.kvFehler}
            erzeugung={version.kvErzeugung}
            werkzeug={
              // Review I6: mit Paketen kein „ד, die Pakete schalten die Hebel.
              (version.status === "entwurf" || kontext.bearbeitbar) && ansicht.pakete.length === 0
                ? {
                    beschaeftigt: lauf !== null,
                    onAus: (hebel, posten) => setDialog({ art: "hebel_aus", hebel, posten }),
                    onPlus: (art) => setDialog({ art: "anpassung", start: { art } }),
                  }
                : undefined
            }
          />
          <KernWarnung kern={ansicht.kern} kvDarstellung={ansicht.kvDarstellung} beschaeftigt={lauf !== null} onPreis={preisOeffnen} />
        </>
      )}
      {plan5 ? (
        stundenModus ? (
          <StundenBlock stunden={ansicht.stunden} erzeugung={version.kvErzeugung} />
        ) : (
          <>
            <PaketPreise pakete={ansicht.pakete} beschaeftigt={lauf !== null} onPreis={preisOeffnen} />
            <TagePreise tage={ansicht.tage} pakete={ansicht.pakete} />
          </>
        )
      ) : (
        <PaketeAnzeige pakete={ansicht.pakete} preisModus={version.preisModus} link={ansicht.angebotsformularLink} />
      )}
      <VerwaisteAnpassungen
        verwaist={ansicht.verwaist}
        anpassungen={ansicht.anpassungen}
        kontext={kontext}
        beschaeftigt={lauf !== null}
        portalZiel={portalZiel}
      />
      <AnpassungenListe
        anpassungen={ohneVerwaiste(ansicht.anpassungen, kontext.bearbeitbar ? ansicht.verwaist : [])}
        beschaeftigt={beschaeftigt}
        onOeffnen={anpassungOeffnen}
      />
      <SperrenBereich
        dealId={kontext.dealId}
        version={version}
        laeuft={lauf}
        onSperren={() => void kvMitVorpruefung(false)}
        onKv={() => void kvMitVorpruefung(true)}
        onNeueVersion={() => void kontext.neueVersion()}
        onNeuRechnen={() => void kontext.neuRechnen()}
        tagespreise={tagesKnopf}
        onTagespreise={() => terminDialogOeffnen({ dealId: kontext.dealId, version: version.nummer })}
      />
    </GlassPanel>

      {dialog?.art === "anpassung" ? (
        <AnpassungDialog
          start={dialog.start}
          zeilen={uebersteuerbareZeilen(ansicht.selbstkosten)}
          felder={ansicht.grundlage.zeilen.flatMap((z) => z.felder)}
          anpassungen={ansicht.anpassungen}
          kontext={kontext}
          portalZiel={portalZiel}
          onSchliessen={() => setDialog(null)}
        />
      ) : null}
      {dialog?.art === "preis" ? (
        <PreisDialog start={dialog.start} ansicht={ansicht} kontext={kontext} portalZiel={portalZiel} onSchliessen={() => setDialog(null)} />
      ) : null}
      {dialog?.art === "moduswechsel" ? (
        <ModuswechselDialog
          meldung={dialog.meldung}
          laeuft={lauf !== null}
          portalZiel={portalZiel}
          onAbbrechen={() => setDialog(null)}
          onBestaetigen={() => void sperrenUndKv(dialog.texte, false, true, ohneAdresseBisher.current)}
        />
      ) : null}
      {dialog?.art === "hebel_aus" ? (
        <HebelAusDialog hebel={dialog.hebel} posten={dialog.posten} kontext={kontext} portalZiel={portalZiel} onSchliessen={() => setDialog(null)} />
      ) : null}
      {dialog?.art === "ohne_adresse" ? (
        <OhneAdresseDialog
          meldung={dialog.meldung}
          fehlt={ansicht.version.adresseFehlt}
          laeuft={lauf !== null}
          portalZiel={portalZiel}
          onAbbrechen={() => setDialog(null)}
          onBestaetigen={() => {
            ohneAdresseBisher.current = true;
            void sperrenUndKv(dialog.texte, false, dialog.modusWechselBestaetigt, true);
          }}
        />
      ) : null}
      {dialog?.art === "angaben" ? (
        <AngabenDialog
          dealId={kontext.dealId}
          art="KV"
          pruefung={dialog.pruefung}
          portalZiel={portalZiel}
          onSchliessen={() => setDialog(null)}
          onWeiter={() => {
            const nurKv = dialog.nurKv;
            setDialog({ art: "kv", nurKv });
            void kontext.neuLaden();
          }}
        />
      ) : null}
      {dialog?.art === "kv" ? (
        <KvDialog
          version={version}
          kv={ansicht.kv}
          stunden={stundenModus ? ansicht.stunden : null}
          laeuft={lauf !== null}
          portalZiel={portalZiel}
          zusatz={<PaketeZeileKasten ansicht={ansicht} kontext={kontext} />}
          onSchliessen={() => setDialog(null)}
          onBestaetigen={(texte) => sperrenUndKv(texte, dialog.nurKv)}
        />
      ) : null}
      {dialog?.art === "kottke" ? (
        <DokumentDialog
          dealId={kontext.dealId}
          art="KV"
          altLink={ansicht.angebotsformularLink}
          portalZiel={portalZiel}
          kopfZusatz={<PaketeZeileKasten ansicht={ansicht} kontext={kontext} gesperrt />}
          onSchliessen={() => {
            setDialog(null);
            void kontext.neuLaden();
          }}
        />
      ) : null}
    </>
  );
}
