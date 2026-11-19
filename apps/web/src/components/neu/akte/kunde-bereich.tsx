"use client";

import "@/styles/neu-akte-kunde.css";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { PortalLeistung } from "@openclaw-crm/customer-portal-core";
import { kundeAnsicht, leistungLabel } from "@/lib/akte-leistung";
import type { DealKunde, KundeEingabe } from "@/lib/deal-kunde";
import { aenderungen, entwurfAus, type KundeEntwurf, type KundeFeld } from "@/lib/kunde-entwurf";
import { apiAufruf } from "./api";
import { AusDemChatKnopf, KUNDE_GEAENDERT_EVENT, KundeFelder, LeistungAuswahl, PersonFrage, kundeSpeichern, kundeWert, leistungSpeichern, type LeistungStand, type PersonKandidat } from "./kunde-felder";

const LABEL: Record<KundeFeld, string> = {
  name: "Name",
  telefon: "Telefon",
  email: "E-Mail",
  auszug: "Kundenanschrift (Auszug)",
  einzug: "Einzug",
  datum: "Umzugsdatum",
};

/** Ohne diese Angaben entsteht kein KV (Vorlage auf crm-tools). */
const KV_PFLICHT: KundeFeld[] = ["name", "auszug"];

/**
 * Bereich „Kunde und Adressen“ der Akte: Leistung, Name, Telefon, E-Mail,
 * Kundenanschrift (Auszug), Einzug und Datum ansehen und bearbeiten (Felder und
 * Namen je Leistung, lib/akte-leistung), mit „Aus dem Chat
 * übernehmen“. Speichert über PUT …/kunde (updateRecord am Lead bzw. an der
 * Person, wie die übrigen Akte-Felder). `offen` (Link „Angaben ergänzen“,
 * `?angaben=1`) öffnet ihn gleich zum Bearbeiten und scrollt hin.
 */
export function KundeBereich({
  dealId,
  offen = false,
  onGespeichert,
}: {
  dealId: string;
  offen?: boolean;
  onGespeichert: () => Promise<void>;
}) {
  const [kunde, setKunde] = useState<DealKunde | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [bearbeiten, setBearbeiten] = useState(offen);
  const [entwurf, setEntwurf] = useState<KundeEntwurf>(entwurfAus(null));
  const [vorgeschlagen, setVorgeschlagen] = useState<KundeFeld[]>([]);
  const [speichert, setSpeichert] = useState(false);
  const [frage, setFrage] = useState<{ kandidaten: PersonKandidat[]; body: KundeEingabe } | null>(null);
  const [leistung, setLeistung] = useState<LeistungStand | null>(null);
  const [leistungEntwurf, setLeistungEntwurf] = useState<PortalLeistung | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const bearbeitet = useRef(bearbeiten);
  bearbeitet.current = bearbeiten;

  useEffect(() => {
    let aktuell = true;
    const laden = (still: boolean) => {
      if (!still) {
        setKunde(null);
        setFehler(null);
      }
      void apiAufruf<DealKunde>(`/api/v1/deals/${encodeURIComponent(dealId)}/kunde`).then((r) => {
        if (!aktuell) return;
        if (!r.ok) return setFehler(r.message);
        // Während des Bearbeitens nichts tauschen: Entwurf und Vergleichsstand müssen zusammenpassen,
        // sonst schriebe Speichern alte Formularwerte über das, was inzwischen gespeichert wurde.
        if (still && bearbeitet.current) return;
        setKunde(r.data);
        setEntwurf(entwurfAus(r.data));
      });
      void apiAufruf<LeistungStand>(`/api/v1/deals/${encodeURIComponent(dealId)}/leistung`).then((r) => {
        if (!aktuell || !r.ok || (still && bearbeitet.current)) return;
        setLeistung(r.data);
        setLeistungEntwurf(r.data.leistung);
      });
    };
    laden(false);
    // Gespeichert im Fenster „Es fehlen noch Angaben“: hier still nachladen.
    const geaendert = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      if (d === dealId) laden(true);
    };
    window.addEventListener(KUNDE_GEAENDERT_EVENT, geaendert);
    return () => {
      aktuell = false;
      window.removeEventListener(KUNDE_GEAENDERT_EVENT, geaendert);
    };
  }, [dealId]);

  useEffect(() => {
    if (!offen) return;
    setBearbeiten(true);
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [offen]);

  function abbrechen() {
    setFrage(null);
    setEntwurf(entwurfAus(kunde));
    setLeistungEntwurf(leistung?.leistung ?? null);
    setVorgeschlagen([]);
    setFehler(null);
    setBearbeiten(false);
  }

  /** Doppelklick, Enter während des Speicherns: nur ein Aufruf (sonst zwei neue Personen). */
  const laeuftRef = useRef(false);

  async function senden(body: KundeEingabe) {
    if (laeuftRef.current) return;
    laeuftRef.current = true;
    setSpeichert(true);
    setFehler(null);
    const r = await kundeSpeichern(dealId, body);
    laeuftRef.current = false;
    setSpeichert(false);
    if (r.art === "frage") return setFrage({ kandidaten: r.kandidaten, body });
    setFrage(null);
    if (r.art === "fehler") return setFehler(r.text);
    setKunde(r.kunde);
    setEntwurf(entwurfAus(r.kunde));
    setVorgeschlagen([]);
    setBearbeiten(false);
    toast.success("Kundendaten gespeichert.");
    await onGespeichert();
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (laeuftRef.current) return;
    const body = aenderungen(entwurf, kunde);
    // Erst die Leistung (sie bestimmt, welche Angaben der KV braucht), dann die Kundendaten.
    if (leistungEntwurf && leistung && leistungEntwurf !== leistung.leistung) {
      laeuftRef.current = true;
      setSpeichert(true);
      setFehler(null);
      const r = await leistungSpeichern(dealId, leistungEntwurf);
      laeuftRef.current = false;
      setSpeichert(false);
      if (!r.ok) return setFehler(r.text);
      setLeistung(r.stand);
      setLeistungEntwurf(r.stand.leistung);
      if (Object.keys(body).length === 0) {
        setBearbeiten(false);
        toast.success(`Leistung: ${leistungLabel(r.stand.leistung)}.`);
        await onGespeichert();
        return;
      }
    }
    if (Object.keys(body).length === 0) return abbrechen();
    await senden({ ...body, quelle: vorgeschlagen.length > 0 ? "chat" : "akte" });
  }

  const fehltFuerKv = kunde ? KV_PFLICHT.filter((f) => !kundeWert(kunde, f)) : [];
  // Felder und Namen nach der Leistung (beim Bearbeiten nach der gerade gewählten).
  const ansicht = kundeAnsicht(bearbeiten ? leistungEntwurf : leistung?.leistung);
  const titel = (f: KundeFeld) => ansicht.labels[f] ?? LABEL[f];

  return (
    <GlassPanel variant="panel" className="kunde-panel" aria-label="Kunde und Adressen" ref={panel}>
      <header className="kunde-panel-kopf">
        <h2>Kunde und Adressen</h2>
        {kunde && !bearbeiten ? (
          <button type="button" className="akte-ablauf-knopf kunde-knopf-klein" onClick={() => setBearbeiten(true)}>
            Bearbeiten
          </button>
        ) : null}
      </header>

      {!kunde && !fehler ? <p className="kunde-hinweis">Lädt …</p> : null}

      {kunde && !bearbeiten ? (
        <>
          <dl className="kunde-zeilen">
            {leistung ? (
              <div className="kunde-zeile">
                <dt>Leistung</dt>
                <dd>{leistungLabel(leistung.leistung)}</dd>
              </div>
            ) : null}
            {ansicht.felder.map((feld) => {
              const wert = kundeWert(kunde, feld);
              const pflicht = KV_PFLICHT.includes(feld);
              return (
                <div key={feld} className="kunde-zeile" data-fehlt={!wert && pflicht ? "" : undefined}>
                  <dt>{titel(feld)}</dt>
                  <dd>{wert ?? (pflicht ? "fehlt, ohne sie entsteht kein KV" : "nicht eingetragen")}</dd>
                </div>
              );
            })}
          </dl>
          {fehltFuerKv.length > 0 ? (
            <p className="kunde-hinweis">
              Steht es im Chat?{" "}
              <button type="button" className="kunde-link" onClick={() => setBearbeiten(true)}>
                Bearbeiten und aus dem Chat übernehmen
              </button>
            </p>
          ) : null}
        </>
      ) : null}

      {kunde && bearbeiten ? (
        <form onSubmit={(e) => void speichern(e)}>
          {leistung && leistungEntwurf ? (
            <LeistungAuswahl
              wert={leistungEntwurf}
              gespeichert={leistung.leistung}
              gesperrt={speichert}
              onAendern={setLeistungEntwurf}
            />
          ) : null}
          <AusDemChatKnopf
            dealId={dealId}
            entwurf={entwurf}
            felder={ansicht.felder}
            disabled={speichert}
            onVorschlag={(neu, gesetzt) => {
              setEntwurf(neu);
              setVorgeschlagen(gesetzt);
            }}
          />
          <KundeFelder
            felder={ansicht.felder}
            labels={ansicht.labels}
            entwurf={entwurf}
            pflicht={KV_PFLICHT}
            vorgeschlagen={vorgeschlagen}
            gesperrt={speichert}
            onAendern={(neu, feld) => {
              setEntwurf(neu);
              setVorgeschlagen((v) => v.filter((f) => f !== feld));
            }}
          />
          {!kunde.nameAusPerson && kunde.personId === null ? (
            <p className="kunde-hinweis">Noch keine Person verknüpft: Speichern legt sie mit Name, Telefon und E-Mail an.</p>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          {frage ? (
            <PersonFrage
              kandidaten={frage.kandidaten}
              name={entwurf.name}
              disabled={speichert}
              onWahl={(personWahl) => void senden({ ...frage.body, personWahl })}
            />
          ) : (
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={abbrechen} disabled={speichert}>
                Abbrechen
              </GlassButton>
              <GlassButton type="submit" disabled={speichert} aria-busy={speichert || undefined}>
                {speichert ? "Speichert …" : "Speichern"}
              </GlassButton>
            </div>
          )}
        </form>
      ) : null}

      {/* Ladefehler immer zeigen, auch wenn der Bereich über „Angaben ergänzen“ gleich zum Bearbeiten offen ist. */}
      {fehler && (!bearbeiten || !kunde) ? (
        <p className="akte-dialog-fehler" role="alert">
          {kunde ? fehler : `Kundendaten konnten nicht geladen werden: ${fehler}`}
        </p>
      ) : null}
    </GlassPanel>
  );
}
