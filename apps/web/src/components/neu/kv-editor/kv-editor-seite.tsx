"use client";

import "@/styles/neu-kv-editor.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import {
  KV_EDITOR_POLL_MS,
  KV_EDITOR_TEXT,
  type KvEditorAnsicht,
  type KvEditorFehlerDaten,
  type KvStandDetail,
  type KvStandKopf,
  type KvWert,
  type StandAnlegenEingabe,
} from "@/lib/kv-editor";
import { KvGepusht, KvHinweis, KvKalkulationNeu, KvKeinKv, KvKonflikte } from "./kv-baender";
import { KvChat } from "./kv-chat";
import { antwortAlsEintrag, uebernehmenEingabe, type ChatEintrag } from "./kv-chat-logik";
import { PushDialog, ZusammenfuehrenDialog } from "./kv-dialoge";
import { fehlerText, offeneKonflikte, pushbar } from "./kv-editor-logik";
import { fixtureQuelle, KV_SZENARIEN, type KvSzenario } from "./kv-editor-fixture";
import { apiQuelle, fehlerDaten, type ApiAntwort, type KvEditorQuelle } from "./kv-editor-quelle";
import { KvFormular, type FormularFehler, type NurLesenZeile } from "./kv-formular";
import {
  abgelehntAusDaten,
  anzahlAenderungen,
  dreiwege,
  eingabeZuWerten,
  formularEingabe,
  mergeEingabe,
  werteAusListe,
  type MergeErgebnis,
} from "./kv-formular-logik";
import { KvKopf, type RechtsPanel } from "./kv-kopf";
import { KvPdf } from "./kv-pdf";
import { KvVerlauf } from "./kv-verlauf";

type Lauf = "speichern" | "pushen" | "neu_drucken" | "konflikte" | "uebertragen" | "chat" | "uebernehmen" | "entwurf";

/** Unter 1024 px: Verlauf und rechte Seite als untere Schublade, nur eine zur Zeit. */
function useSchmal(): boolean {
  const [schmal, setSchmal] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 1023.98px)");
    const setzen = () => setSchmal(m.matches);
    setzen();
    m.addEventListener("change", setzen);
    return () => m.removeEventListener("change", setzen);
  }, []);
  return schmal;
}

function szenarioAusUrl(): KvSzenario {
  if (typeof window === "undefined") return "standard";
  const s = new URLSearchParams(window.location.search).get("szenario");
  return (KV_SZENARIEN as readonly string[]).includes(s ?? "") ? (s as KvSzenario) : "standard";
}

/**
 * Einstieg der Seite `/app/leads/[id]/kv`. Aufgabe 6a: `testdaten` zeigt die Testdaten
 * (`?szenario=…`, siehe `KV_SZENARIEN`); 6b nimmt `testdaten` weg, dann spricht der Editor
 * mit den Routen aus Aufgabe 5 (`apiQuelle`).
 */
export function KvEditorSeite({ dealId, testdaten = false }: { dealId: string; testdaten?: boolean }) {
  const quelle = useMemo(() => (testdaten ? fixtureQuelle(szenarioAusUrl()) : apiQuelle(dealId)), [dealId, testdaten]);
  const nurLesen = useMemo(() => ("nurLesen" in quelle ? (quelle as ReturnType<typeof fixtureQuelle>).nurLesen() : []), [quelle]);
  return (
    <>
      {testdaten ? (
        <p className="kve-band" data-ton="blau" role="note">
          <span>Testdaten (Aufgabe 6a). Nichts hier ist echt, nichts wird gespeichert.</span>
        </p>
      ) : null}
      <KvEditor dealId={dealId} quelle={quelle} nurLesen={nurLesen} bildUrl={testdaten ? undefined : (id) => `/api/v1/deals/${encodeURIComponent(dealId)}/attachments/${encodeURIComponent(id)}`} />
    </>
  );
}

/**
 * Der KV-Editor (Spec 10, Skizze): Kopf mit Verlauf, Sprechblase, Bearbeiten und Pushen;
 * in der Mitte das PDF; links der Verlauf, rechts Formular oder Chat. Spricht nur mit der
 * `quelle`. Fragt druckende Stände alle `pollMs` ab.
 */
export function KvEditor({
  dealId,
  quelle,
  nurLesen = [],
  bildUrl,
  pollMs = KV_EDITOR_POLL_MS,
  start,
}: {
  dealId: string;
  quelle: KvEditorQuelle;
  /** Umzugsgut ohne Lead-ID (nur lesend). Steht noch nicht im Vertrag (Bericht 6a). */
  nurLesen?: NurLesenZeile[];
  bildUrl?: (anhangId: string) => string | null;
  pollMs?: number;
  /** Nur Vorschau und Tests: Panels beim ersten Bild. */
  start?: { verlauf?: boolean; rechts?: RechtsPanel };
}) {
  const portalZiel = usePortalZiel();
  const schmal = useSchmal();
  const [ansicht, setAnsicht] = useState<KvEditorAnsicht | null>(null);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [gewaehltId, setGewaehltId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, KvStandDetail>>({});
  const [verlaufOffen, setVerlaufOffen] = useState(start?.verlauf ?? false);
  const [rechts, setRechts] = useState<RechtsPanel>(start?.rechts ?? null);
  const [laeuft, setLaeuft] = useState<Lauf | null>(null);
  const [formFehler, setFormFehler] = useState<FormularFehler | null>(null);
  const [pushOffen, setPushOffen] = useState(false);
  const [pushFehler, setPushFehler] = useState<string | null>(null);
  const [gepusht, setGepusht] = useState<{ nummer: number; annahmeAufgehoben: boolean } | null>(null);
  const [merge, setMerge] = useState<{ ergebnis: MergeErgebnis; neuester: KvStandKopf; detail: KvStandDetail } | null>(null);
  const [mergeFehler, setMergeFehler] = useState<string | null>(null);
  const [kalkNeu, setKalkNeu] = useState<{ text: string; standId: string } | null>(null);
  const [bandFehler, setBandFehler] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatEintrag[] | null>(null);
  const [chatFehler, setChatFehler] = useState<string | null>(null);
  const [uebernimmt, setUebernimmt] = useState<string | null>(null);
  const jetzt = new Date();

  const detailLaden = useCallback(
    async (id: string) => {
      const r = await quelle.stand(id);
      if (!r.ok) return null;
      const d = r.data;
      setDetails((alt) => ({ ...alt, [id]: d }));
      // Kopf in der Liste nachziehen (Status, Preisprüfung, Fehler).
      setAnsicht((a) => (a ? { ...a, staende: a.staende.map((s) => (s.id === id ? kopfAus(d) : s)) } : a));
      return d;
    },
    [quelle]
  );

  const laden = useCallback(
    async (waehlen?: string) => {
      const r = await quelle.ansicht();
      if (!r.ok) {
        setLadeFehler(fehlerText(r.code, r.message, fehlerDaten(r)));
        return null;
      }
      setLadeFehler(null);
      setAnsicht(r.data);
      const neuester = r.data.staende[0]?.id ?? null;
      setGewaehltId((alt) => waehlen ?? (alt && r.data.staende.some((s) => s.id === alt) ? alt : neuester));
      if (neuester) void detailLaden(neuester);
      if (waehlen && waehlen !== neuester) void detailLaden(waehlen);
      return r.data;
    },
    [quelle, detailLaden]
  );

  useEffect(() => {
    void laden();
  }, [laden]);

  // Druckende Stände abfragen, bis `fertig` oder `fehler` (Spec 7.2 Schritt 4).
  const druckende = (ansicht?.staende ?? []).filter((s) => s.status === "druckt").map((s) => s.id);
  const druckSchluessel = druckende.join(",");
  useEffect(() => {
    if (!druckSchluessel) return;
    const ids = druckSchluessel.split(",");
    const t = window.setInterval(() => {
      for (const id of ids) void detailLaden(id);
    }, pollMs);
    return () => window.clearInterval(t);
  }, [druckSchluessel, pollMs, detailLaden]);

  // Chat-Verlauf beim ersten Öffnen.
  useEffect(() => {
    if (rechts !== "chat" || chat !== null) return;
    void quelle.chatVerlauf().then((r) => setChat(r.ok ? r.data : []));
  }, [rechts, chat, quelle]);

  if (ladeFehler && !ansicht) {
    return (
      <div className="kve-leer" role="alert">
        <h1>KV</h1>
        <p>{ladeFehler}</p>
        <button type="button" className="kve-knopf" onClick={() => void laden()}>
          Neu laden
        </button>
      </div>
    );
  }
  if (!ansicht) return <KvSkelett />;
  if (ansicht.hinweis === "kein_kv" || ansicht.staende.length === 0) return <KvKeinKv kalkulationUrl={ansicht.preis.kalkulationUrl} />;

  const a = ansicht;
  const arbeit = a.staende[0];
  const arbeitDetail = details[arbeit.id] ?? null;
  const gewaehlt = a.staende.find((s) => s.id === gewaehltId) ?? arbeit;
  const beschaeftigt = laeuft !== null;
  const konfliktStand = a.staende.find((s) => s.aktuell && offeneKonflikte(s).length > 0) ?? a.staende.find((s) => offeneKonflikte(s).length > 0) ?? null;
  const felder = arbeitDetail?.basis.felder ?? [];

  function rechtsSetzen(p: RechtsPanel) {
    setRechts(p);
    if (p) {
      setGewaehltId(arbeit.id);
      if (schmal) setVerlaufOffen(false);
    }
  }

  function verlaufUmschalten() {
    setVerlaufOffen((x) => !x);
    if (schmal) setRechts(null);
  }

  function schubladenZu() {
    setVerlaufOffen(false);
    setRechts(null);
  }

  /** Nach einem neuen Stand: neu laden und auf ihn springen. */
  async function neuerStand(s: KvStandKopf, meldung: string) {
    await laden(s.id);
    toast.success(meldung, { description: s.status === "druckt" ? "Wird gedruckt." : undefined });
  }

  /** Gemeinsame Behandlung der Fehler, die alle Schreibwege kennen. */
  function allgemeinerFehler(r: Extract<ApiAntwort<unknown>, { ok: false }>, standId: string): string {
    const daten = fehlerDaten(r);
    if (r.code === "KALKULATION_NEU") setKalkNeu({ text: fehlerText(r.code, r.message, daten), standId });
    return fehlerText(r.code, r.message, daten);
  }

  async function speichern(eingaben: Record<string, KvWert>) {
    if (!arbeitDetail) return;
    const e = formularEingabe(arbeitDetail.basis, arbeitDetail.werte, eingaben, arbeitDetail.id);
    if (anzahlAenderungen(e) === 0) return;
    setLaeuft("speichern");
    setFormFehler(null);
    const r = await quelle.standAnlegen(e);
    setLaeuft(null);
    if (r.ok) {
      await neuerStand(r.data, `Stand ${r.data.nummer} gespeichert.`);
      return;
    }
    const daten = fehlerDaten(r);
    if (r.code === "STAND_VERALTET") {
      const neuester = (daten as KvEditorFehlerDaten["STAND_VERALTET"] | undefined)?.neuester;
      if (neuester) {
        setMergeFehler(null);
        setMerge({ ergebnis: dreiwege(arbeitDetail.basis, arbeitDetail.aenderungen, eingaben, neuester.aenderungen), neuester, detail: arbeitDetail });
        return;
      }
    }
    if (r.code === "UNGUELTIG") {
      setFormFehler({ abgelehnt: abgelehntAusDaten(daten), meldung: KV_EDITOR_TEXT.UNGUELTIG });
      return;
    }
    setFormFehler({ abgelehnt: [], meldung: allgemeinerFehler(r, arbeit.id) });
  }

  async function zusammenfuehren(wahl: Record<string, "meins" | "deren">) {
    if (!merge) return;
    const e = mergeEingabe(merge.detail.basis, merge.ergebnis, wahl, merge.neuester);
    if (anzahlAenderungen(e) === 0) {
      setMerge(null);
      await laden(merge.neuester.id);
      return;
    }
    setLaeuft("speichern");
    const r = await quelle.standAnlegen(e);
    setLaeuft(null);
    if (r.ok) {
      setMerge(null);
      await neuerStand(r.data, `Zusammengeführt, Stand ${r.data.nummer} gespeichert.`);
      return;
    }
    const daten = fehlerDaten(r);
    const noch = r.code === "STAND_VERALTET" ? (daten as KvEditorFehlerDaten["STAND_VERALTET"] | undefined)?.neuester : undefined;
    if (noch) {
      // Schon wieder jemand schneller: auf den neuen Stand legen, Wahl neu treffen.
      const ziel = { ...merge.ergebnis.werte };
      for (const k of merge.ergebnis.konflikte) if (wahl[k.schluessel] === "meins") ziel[k.schluessel] = k.meins;
      setMerge({ ergebnis: dreiwege(merge.detail.basis, merge.neuester.aenderungen, ziel, noch.aenderungen), neuester: noch, detail: merge.detail });
      setMergeFehler(KV_EDITOR_TEXT.STAND_VERALTET);
      return;
    }
    if (r.code === "UNGUELTIG") {
      setMergeFehler(abgelehntAusDaten(daten).map((x) => KV_EDITOR_TEXT[x.grund]).join(" ") || KV_EDITOR_TEXT.UNGUELTIG);
      return;
    }
    setMergeFehler(allgemeinerFehler(r, arbeit.id));
  }

  async function pushen(bestaetigt: boolean) {
    setLaeuft("pushen");
    setPushFehler(null);
    const r = await quelle.pushen(gewaehlt.id, { erwartetAktuellDokumentId: a.aktuellDokumentId, ...(bestaetigt ? { annahmeAufhebenBestaetigt: true } : {}) });
    setLaeuft(null);
    if (r.ok) {
      setPushOffen(false);
      setGepusht({ nummer: r.data.stand.nummer, annahmeAufgehoben: r.data.annahmeAufgehoben });
      await laden(r.data.stand.id);
      return;
    }
    const text = allgemeinerFehler(r, gewaehlt.id);
    if (r.code === "KALKULATION_NEU") {
      setPushOffen(false);
      return;
    }
    // Annahme inzwischen aktiv oder anderer Stand gepusht: Ansicht neu laden, Dialog zeigt den neuen Fall.
    if (r.code === "ANNAHME_AKTIV" || r.code === "AKTUELL_GEAENDERT" || r.code === "STAND_NICHT_FERTIG") await laden();
    setPushFehler(text);
  }

  async function schreiben(art: Lauf, lauf: () => Promise<ApiAntwort<KvStandKopf>>, meldung: (s: KvStandKopf) => string, standId: string) {
    setLaeuft(art);
    setBandFehler(null);
    const r = await lauf();
    setLaeuft(null);
    if (r.ok) {
      if (art === "uebertragen") setKalkNeu(null);
      await neuerStand(r.data, meldung(r.data));
    } else {
      setBandFehler(allgemeinerFehler(r, standId));
    }
  }

  async function alsEntwurf(standId: string) {
    const alt = a.staende.find((s) => s.id === standId);
    if (!alt || !arbeitDetail) return;
    const e: StandAnlegenEingabe = eingabeZuWerten(arbeitDetail.basis, arbeit.aenderungen, werteAusListe(arbeitDetail.basis, alt.aenderungen), arbeit.id);
    if (anzahlAenderungen(e) === 0) {
      toast.message(`Stand ${arbeit.nummer} hat schon dieselben Änderungen wie Stand ${alt.nummer}.`);
      return;
    }
    await schreiben("entwurf", () => quelle.standAnlegen(e), (s) => `Stand ${s.nummer} aus Stand ${alt.nummer} angelegt.`, arbeit.id);
  }

  async function konflikt(stand: KvStandKopf, schluessel: string, aktion: "uebernehmen" | "verwerfen") {
    setLaeuft("konflikte");
    setBandFehler(null);
    const r = await quelle.konflikte({ standId: stand.id, entscheidungen: [{ schluessel, aktion }] });
    setLaeuft(null);
    if (!r.ok) {
      setBandFehler(allgemeinerFehler(r, stand.id));
      return;
    }
    if (r.data.neuerEntwurf) await neuerStand(r.data.neuerEntwurf, `Übernommen, Stand ${r.data.neuerEntwurf.nummer} angelegt.`);
    else await laden();
  }

  async function chatSenden(text: string): Promise<boolean> {
    const am = new Date().toISOString();
    const eigener: ChatEintrag = { rolle: "nutzer", text, am, von: null, standId: arbeit.id };
    setChat((c) => [...(c ?? []), eigener]);
    setChatFehler(null);
    setLaeuft("chat");
    const r = await quelle.chat({ standId: arbeit.id, text });
    setLaeuft(null);
    if (!r.ok) {
      // Nichts gespeichert (Spec 11): Beitrag wieder weg, Text bleibt im Feld.
      setChat((c) => (c ?? []).filter((x) => x !== eigener));
      setChatFehler(fehlerText(r.code, r.message, fehlerDaten(r)));
      return false;
    }
    setChat((c) => [...(c ?? []), antwortAlsEintrag(r.data, arbeit.id, new Date().toISOString())]);
    return true;
  }

  async function chatUebernehmen(e: ChatEintrag, auswahl: Set<string>) {
    const eingabe = uebernehmenEingabe(e, auswahl);
    if (!eingabe || !e.nachrichtId) return;
    setUebernimmt(e.nachrichtId);
    setLaeuft("uebernehmen");
    setChatFehler(null);
    const r = await quelle.standAnlegen(eingabe);
    setLaeuft(null);
    setUebernimmt(null);
    if (r.ok) {
      setChat((c) => (c ?? []).map((x) => (x.nachrichtId === e.nachrichtId ? { ...x, uebernommen: true, uebernommeneSchluessel: eingabe.setzen.map((v) => v.schluessel) } : x)));
      await neuerStand(r.data, `Vorschlag übernommen, Stand ${r.data.nummer} gespeichert.`);
      return;
    }
    if (r.code === "STAND_VERALTET") {
      setChatFehler(`${KV_EDITOR_TEXT.STAND_VERALTET} Schick deine Bitte noch einmal, dann schlägt die KI auf dem neuen Stand vor.`);
      await laden();
      return;
    }
    if (r.code === "UNGUELTIG") {
      const gruende = abgelehntAusDaten(fehlerDaten(r)).map((x) => KV_EDITOR_TEXT[x.grund]);
      setChatFehler([KV_EDITOR_TEXT.UNGUELTIG, ...new Set(gruende)].join(" "));
      return;
    }
    setChatFehler(allgemeinerFehler(r, arbeit.id));
  }

  return (
    <div className="kve" data-verlauf={verlaufOffen || undefined} data-rechts={rechts ?? undefined}>
      <KvKopf
        ansicht={a}
        stand={gewaehlt}
        verlaufOffen={verlaufOffen}
        rechts={rechts}
        pushSichtbar={pushbar(gewaehlt)}
        bearbeitbar={!!arbeitDetail}
        beschaeftigt={beschaeftigt}
        onVerlauf={verlaufUmschalten}
        onRechts={rechtsSetzen}
        onPushen={() => {
          setPushFehler(null);
          setPushOffen(true);
        }}
      />

      <div className="kve-baender">
        {gepusht ? <KvGepusht dealId={dealId} nummer={gepusht.nummer} annahmeAufgehoben={gepusht.annahmeAufgehoben} onSchliessen={() => setGepusht(null)} /> : null}
        {kalkNeu ? (
          <KvKalkulationNeu
            text={kalkNeu.text}
            beschaeftigt={beschaeftigt}
            onUebertragen={() => void schreiben("uebertragen", () => quelle.uebertragen(kalkNeu.standId), (s) => `Auf den neuen KV übertragen, Stand ${s.nummer}.`, kalkNeu.standId)}
          />
        ) : null}
        {bandFehler ? (
          <p className="kve-band" data-ton="rose" role="alert">
            <span>{bandFehler}</span>
            <button type="button" className="kve-link" onClick={() => setBandFehler(null)}>
              Ausblenden
            </button>
          </p>
        ) : null}
        <KvHinweis
          ansicht={a}
          beschaeftigt={beschaeftigt}
          onUebertragen={(id) => void schreiben("uebertragen", () => quelle.uebertragen(id), (s) => `Änderungen übertragen, Stand ${s.nummer}.`, id)}
        />
        {konfliktStand ? (
          <KvKonflikte
            stand={konfliktStand}
            felder={felder}
            firma={a.firma}
            beschaeftigt={beschaeftigt}
            onEntscheiden={(k, aktion) => void konflikt(konfliktStand, k, aktion)}
          />
        ) : null}
        {gewaehlt.id !== arbeit.id ? (
          <p className="kve-band" data-ton="blau" role="status">
            <span>
              Du siehst Stand {gewaehlt.nummer}. Neuester ist Stand {arbeit.nummer}.
            </span>
            <button type="button" className="kve-klein-knopf" onClick={() => setGewaehltId(arbeit.id)}>
              Zum neuesten
            </button>
          </p>
        ) : null}
      </div>

      <div className="kve-flaeche">
        {verlaufOffen ? (
          <KvVerlauf
            staende={a.staende}
            gewaehltId={gewaehlt.id}
            felder={felder}
            firma={a.firma}
            jetzt={jetzt}
            pdfUrl={(id) => quelle.pdfUrl(id)}
            beschaeftigt={beschaeftigt}
            onAnsehen={(id) => {
              setGewaehltId(id);
              if (schmal) setVerlaufOffen(false);
            }}
            onAlsEntwurf={(id) => void alsEntwurf(id)}
            onSchliessen={() => setVerlaufOffen(false)}
          />
        ) : null}
        <div className="kve-mitte">
          <KvPdf
            stand={gewaehlt}
            pdfUrl={quelle.pdfUrl(gewaehlt.id)}
            jetzt={jetzt}
            beschaeftigt={beschaeftigt}
            onNeuDrucken={() => void schreiben("neu_drucken", () => quelle.neuDrucken(gewaehlt.id), (s) => `Stand ${s.nummer} wird neu gedruckt.`, gewaehlt.id)}
          />
        </div>
        {rechts === "formular" ? (
          arbeitDetail ? (
            <KvFormular
              key={arbeitDetail.id}
              stand={arbeitDetail}
              firma={a.firma}
              preis={a.preis}
              nurLesen={nurLesen}
              bildUrl={bildUrl}
              fehler={formFehler}
              speichert={laeuft === "speichern"}
              onSpeichern={(e) => void speichern(e)}
              onSchliessen={() => setRechts(null)}
            />
          ) : (
            <aside className="kve-seite" data-seite="rechts" aria-busy="true" aria-label="Bearbeiten">
              <span className="lg-skeleton kve-skelett-panel" />
            </aside>
          )
        ) : null}
        {rechts === "chat" ? (
          <KvChat
            eintraege={chat ?? []}
            felder={felder}
            firma={a.firma}
            jetzt={jetzt}
            sendet={laeuft === "chat"}
            uebernimmt={uebernimmt}
            fehler={chatFehler}
            onSenden={chatSenden}
            onUebernehmen={(e, auswahl) => void chatUebernehmen(e, auswahl)}
            onSchliessen={() => setRechts(null)}
          />
        ) : null}
      </div>
      {verlaufOffen || rechts ? <button type="button" className="kve-schleier" aria-label="Schließen" tabIndex={-1} onClick={schubladenZu} /> : null}

      {pushOffen ? (
        <PushDialog
          portalZiel={portalZiel}
          stand={gewaehlt}
          ansicht={a}
          laeuft={laeuft === "pushen"}
          fehler={pushFehler}
          onPushen={(b) => void pushen(b)}
          onAbbrechen={() => setPushOffen(false)}
        />
      ) : null}
      {merge ? (
        <ZusammenfuehrenDialog
          portalZiel={portalZiel}
          ergebnis={merge.ergebnis}
          neuester={merge.neuester}
          firma={a.firma}
          laeuft={laeuft === "speichern"}
          fehler={mergeFehler}
          onSpeichern={(w) => void zusammenfuehren(w)}
          onAbbrechen={() => {
            setMerge(null);
            void laden();
          }}
        />
      ) : null}
    </div>
  );
}

function kopfAus(d: KvStandDetail): KvStandKopf {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { basis, werte, unterschied, ...kopf } = d;
  return kopf;
}

function KvSkelett() {
  return (
    <div className="kve" aria-busy="true" aria-label="KV wird geladen">
      <div className="kve-kopf">
        <span className="lg-skeleton kve-skelett-titel" />
      </div>
      <div className="kve-flaeche">
        <div className="kve-mitte">
          <span className="lg-skeleton kve-skelett-pdf" />
        </div>
      </div>
    </div>
  );
}
