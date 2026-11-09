"use client";

import "@/styles/neu-kalk.css";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import type { NeueUebersteuerungsArt } from "@/lib/angebot-wahl";
import type { UebersteuerungsArt } from "@/lib/kalkulation-versionen";
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import { TerminDialogEmpfaenger } from "@/components/neu/termin/termin-dialog";
import { AnnahmenKasten } from "./annahmen-kasten";
import { GrundlageSpalte } from "./grundlage-spalte";
import { KalkKopf } from "./kalk-kopf";
import { DOKUMENT_ABGELEGT_EVENT, eventBetrifftDeal, KV_NACHLADEN_MS } from "./kv-erzeugung";
import { MargeSpalte } from "./marge-spalte";
import { SelbstkostenSpalte } from "./selbstkosten-spalte";

/** Welche Aktion gerade läuft; währenddessen sind alle Eingaben gesperrt (Review Focus 5). */
export type Lauf = "neue_version" | "neu_rechnen" | "speichern" | "sperren";

/** Eine Übersteuerung, wie `POST …/overrides` sie erwartet (Plan 5b: auch Paketpreis, Tagespreis, KV-Darstellung, Preismodus). */
export interface UebersteuerungEingabe {
  art: UebersteuerungsArt | NeueUebersteuerungsArt;
  key: string;
  wert: unknown;
  grund: string;
  fotoRef?: string | null;
}

export type Ergebnis = { ok: true } | { ok: false; message: string };

/**
 * Was die Spalten brauchen, um zu schreiben: Deal, Version, ob sie bearbeitbar
 * ist, der laufende Vorgang und die Aktionen der Seite. Übersteuerungen an
 * einer gesperrten Version landen im Entwurf; die Seite springt dann dorthin
 * (Review Focus 2).
 */
export interface KalkKontext {
  dealId: string;
  versionNr: number;
  bearbeitbar: boolean;
  laeuft: Lauf | null;
  /** Mehrere Übersteuerungen nacheinander (eine je geändertem Feld), danach einmal neu laden. */
  uebersteuern: (liste: UebersteuerungEingabe[]) => Promise<Ergebnis>;
  neuLaden: () => Promise<void>;
  neueVersion: () => Promise<void>;
  neuRechnen: () => Promise<void>;
  wechsleVersion: (version: number) => void;
  /** Für längere Vorgänge der Spalten (Sperren, KV): Lauf setzen und wieder lösen. */
  setzeLauf: (lauf: Lauf | null) => void;
  /** Ein Reglerwert wartet noch auf sein Speichern (800 ms): Versionen und Sperren bleiben so lange zu (I2, M3). */
  ausstehend: boolean;
  setzeAusstehend: (an: boolean) => void;
}

interface VersionsEintrag {
  version: number;
  status: "entwurf" | "gesperrt";
  priceCents: number | null;
}

type Zustand =
  | { art: "laden" }
  | { art: "erstellen" }
  | { art: "nicht_gefunden" }
  | { art: "fehler"; meldung: string }
  | { art: "fertig"; ansicht: KalkulationsAnsicht };

function basis(dealId: string): string {
  return `/api/v1/deals/${encodeURIComponent(dealId)}/calculation/versions`;
}

/** `?v=` aus der Adresszeile, null ohne oder bei Unsinn. */
function versionAusUrl(): number | null {
  if (typeof window === "undefined") return null;
  const roh = new URLSearchParams(window.location.search).get("v");
  if (!roh || !/^[1-9]\d*$/.test(roh)) return null;
  return Number(roh);
}

/** `?v=` in der Adresszeile nachziehen, ohne Navigation. */
function versionInUrl(version: number) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("v") === String(version)) return;
  url.searchParams.set("v", String(version));
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Standard: der Entwurf, sonst die neueste gesperrte Version (Task 8). */
export function standardVersion(liste: VersionsEintrag[], gewuenscht: number | null): number | null {
  if (gewuenscht !== null && liste.some((v) => v.version === gewuenscht)) return gewuenscht;
  const entwurf = liste.find((v) => v.status === "entwurf");
  if (entwurf) return entwurf.version;
  let neueste: number | null = null;
  for (const v of liste) if (neueste === null || v.version > neueste) neueste = v.version;
  return neueste;
}

/**
 * Die Kalkulationsseite (Plan 4, Entscheidung 2): lädt die Versionsliste,
 * legt ohne Version einen Entwurf an („Kalkulation wird erstellt“), dann das
 * Ansichtsmodell `GET …/[v]/ansicht`. Kopf, Hinweisband und drei Spalten
 * (Grundlage, Selbstkosten, Marge und Preis). Alle Schreibwege laufen über
 * den Kontext; während eines Laufs ist alles gesperrt.
 */
export function KalkSeite({ dealId }: { dealId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [laeuft, setLaeuft] = useState<Lauf | null>(null);
  const [ausstehend, setAusstehend] = useState(false);
  const lauf = useRef(0);
  const versionNr = useRef<number | null>(null);
  const hatSeite = useRef(false);
  hatSeite.current = zustand.art === "fertig";

  /** Ansicht einer Version laden; null = Standard. `leise`: ohne Fehlermeldung (Nachladen im Hintergrund). */
  const laden = useCallback(async (deal: string, gewuenscht: number | null, leise = false): Promise<void> => {
    const dieser = ++lauf.current;
    const stillOhneSeite = !hatSeite.current;
    const fehlschlag = (f: { status: number; message: string }) => {
      if (dieser !== lauf.current) return;
      if (!stillOhneSeite) {
        if (leise) return;
        toast.error("Kalkulation konnte nicht neu geladen werden.", { description: f.message });
        return;
      }
      setZustand(f.status === 404 ? { art: "nicht_gefunden" } : { art: "fehler", meldung: f.message });
    };

    const liste = await apiAufruf<{ versionen: VersionsEintrag[] }>(basis(deal));
    if (dieser !== lauf.current) return;
    if (!liste.ok) return fehlschlag(liste);

    let version = standardVersion(liste.data.versionen ?? [], gewuenscht);
    if (version === null) {
      if (stillOhneSeite) setZustand({ art: "erstellen" });
      const neu = await apiAufruf<{ version: { version: number }; neu: boolean }>(basis(deal), jsonAufruf("POST", {}));
      if (dieser !== lauf.current) return;
      if (!neu.ok) return fehlschlag(neu);
      version = neu.data.version.version;
    }

    const ansicht = await apiAufruf<{ ansicht: KalkulationsAnsicht }>(`${basis(deal)}/${version}/ansicht`);
    if (dieser !== lauf.current) return;
    if (!ansicht.ok) return fehlschlag(ansicht);
    versionNr.current = version;
    versionInUrl(version);
    setZustand({ art: "fertig", ansicht: ansicht.data.ansicht });
  }, []);

  useEffect(() => {
    hatSeite.current = false;
    versionNr.current = null;
    setZustand({ art: "laden" });
    setLaeuft(null);
    setAusstehend(false);
    void laden(dealId, versionAusUrl());
    return () => {
      lauf.current++;
    };
  }, [dealId, laden]);

  const neuLaden = useCallback(async () => {
    await laden(dealId, versionNr.current);
  }, [laden, dealId]);

  // Nachladen im Hintergrund nur ohne laufende Aktion: deren eigenes Laden hätte sonst
  // das Nachsehen (Zählerschutz in `laden`) und die Seite spränge auf die alte Version.
  const frei = useRef(true);
  frei.current = laeuft === null && !ausstehend;
  const kvLaeuft = zustand.art === "fertig" && zustand.ansicht.version.kvErzeugung.art === "laeuft";

  // Plan 5a: ein abgelegtes Dokument (alter Dialog, Hintergrund-Jobs) lädt die Seite neu.
  useEffect(() => {
    const beiAblage = (e: Event) => {
      if (!eventBetrifftDeal((e as CustomEvent).detail, dealId) || !frei.current || !hatSeite.current) return;
      void laden(dealId, versionNr.current, true);
    };
    window.addEventListener(DOKUMENT_ABGELEGT_EVENT, beiAblage);
    return () => window.removeEventListener(DOKUMENT_ABGELEGT_EVENT, beiAblage);
  }, [dealId, laden]);

  // Solange der VPS den KV erzeugt: sparsam nachladen, nur bei sichtbarem Tab; endet mit dem Zustand oder beim Verlassen.
  useEffect(() => {
    if (!kvLaeuft) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !frei.current) return;
      void laden(dealId, versionNr.current, true);
    }, KV_NACHLADEN_MS);
    return () => window.clearInterval(id);
  }, [kvLaeuft, dealId, laden]);

  const wechsleVersion = useCallback(
    (version: number) => {
      void laden(dealId, version);
    },
    [laden, dealId]
  );

  // Der Lauf endet erst, wenn die Ansicht neu geladen ist (M4): bis dahin bleibt alles gesperrt.
  const neueVersion = useCallback(async () => {
    setLaeuft("neue_version");
    try {
      const r = await apiAufruf<{ version: { version: number }; neu: boolean }>(basis(dealId), jsonAufruf("POST", {}));
      if (!r.ok) {
        toast.error("Neue Version konnte nicht angelegt werden.", { description: r.message });
        return;
      }
      if (!r.data.neu) toast.message(`Entwurf v${r.data.version.version} gibt es schon.`);
      await laden(dealId, r.data.version.version);
    } finally {
      setLaeuft(null);
    }
  }, [dealId, laden]);

  const neuRechnen = useCallback(async () => {
    const v = versionNr.current;
    if (v === null) return;
    setLaeuft("neu_rechnen");
    try {
      const r = await apiAufruf<{ version: { version: number }; gerechnet: boolean }>(
        `${basis(dealId)}/${v}/neu-rechnen`,
        jsonAufruf("POST", {})
      );
      if (!r.ok) {
        toast.error("Neu rechnen fehlgeschlagen.", { description: r.message });
        return;
      }
      if (!r.data.gerechnet) toast.message("Nichts neu gerechnet.", { description: "Der Entwurf war schon aktuell." });
      await laden(dealId, v);
    } finally {
      setLaeuft(null);
    }
  }, [dealId, laden]);

  const uebersteuern = useCallback(
    async (liste: UebersteuerungEingabe[]): Promise<Ergebnis> => {
      let ziel = versionNr.current;
      if (ziel === null || liste.length === 0) return { ok: false, message: "Nichts zu speichern." };
      const start = ziel;
      setLaeuft("speichern");
      try {
        for (const e of liste) {
          const r: ApiAntwort<{ version: { version: number }; neu: boolean }> = await apiAufruf(
            `${basis(dealId)}/${ziel}/overrides`,
            jsonAufruf("POST", { art: e.art, key: e.key, wert: e.wert, grund: e.grund, fotoRef: e.fotoRef ?? null })
          );
          if (!r.ok) {
            // Teilweise gespeichert: die Seite zeigt den echten Stand.
            await laden(dealId, ziel);
            return { ok: false, message: r.message };
          }
          // An einer gesperrten Version landet die Änderung im Entwurf: die weiteren dorthin.
          ziel = r.data.version.version;
        }
        if (ziel !== start) toast.message(`Änderung im Entwurf v${ziel} gespeichert.`);
        await laden(dealId, ziel);
        return { ok: true };
      } finally {
        setLaeuft(null);
      }
    },
    [dealId, laden]
  );

  if (zustand.art === "laden" || zustand.art === "erstellen") {
    return <KalkSkelett erstellen={zustand.art === "erstellen"} />;
  }

  if (zustand.art === "nicht_gefunden") {
    return (
      <Hinweis titel="Kalkulation nicht gefunden" text="Diesen Deal gibt es nicht oder nicht in diesem Workspace.">
        <GlassButton asChild>
          <Link href="/app/leads">Zu den Leads</Link>
        </GlassButton>
      </Hinweis>
    );
  }

  if (zustand.art === "fehler") {
    return (
      <Hinweis titel="Kalkulation konnte nicht geladen werden" text={zustand.meldung}>
        <GlassButton onClick={() => void laden(dealId, versionAusUrl())}>Erneut laden</GlassButton>
      </Hinweis>
    );
  }

  const { ansicht } = zustand;
  const kontext: KalkKontext = {
    dealId,
    versionNr: ansicht.version.nummer,
    bearbeitbar: ansicht.version.bearbeitbar,
    laeuft,
    uebersteuern,
    neuLaden,
    neueVersion,
    neuRechnen,
    wechsleVersion,
    setzeLauf: setLaeuft,
    ausstehend,
    setzeAusstehend: setAusstehend,
  };
  const beschaeftigt = laeuft !== null || ausstehend;

  return (
    <div className="kalk">
      <KalkKopf
        kopf={ansicht.kopf}
        versionen={ansicht.versionen}
        version={ansicht.version}
        beschaeftigt={beschaeftigt}
        onWechsel={wechsleVersion}
        onNeueVersion={() => void neueVersion()}
      />
      <Hinweisband version={ansicht.version} laeuft={laeuft} onNeuRechnen={() => void neuRechnen()} />
      <AnnahmenKasten kasten={ansicht.annahmen} />
      <div className="kalk-spalten">
        <div className="kalk-spalte">
          <GrundlageSpalte grundlage={ansicht.grundlage} kontext={kontext} />
        </div>
        <div className="kalk-spalte">
          <SelbstkostenSpalte
            selbstkosten={ansicht.selbstkosten}
            vorlagen={ansicht.zeitpostenVorlagen}
            anpassungen={ansicht.anpassungen}
            felder={ansicht.grundlage.zeilen.flatMap((z) => z.felder)}
            kontext={kontext}
            fahrtZeile={ansicht.grundlage.zeilen.find((z) => z.key === "fahrt")}
          />
        </div>
        <div className="kalk-spalte">
          <MargeSpalte ansicht={ansicht} kontext={kontext} />
        </div>
      </div>
      {/* Knopf „Tagespreise im Termin-Dialog“ (Plan 5b, Entscheidung 15): gespeicherte Tage oder ein Sperren im Dialog zeigen danach diese Version. */}
      <TerminDialogEmpfaenger
        dealId={dealId}
        onSchliessen={(e) => {
          if (e.geaendert && e.version) wechsleVersion(e.version);
        }}
      />
    </div>
  );
}

/**
 * Band über den Spalten: Rechnerfehler (rose) oder veralteter Entwurf (gold),
 * beide mit „Neu rechnen“ (Entscheidung 5), gesperrt während des Laufs.
 */
function Hinweisband({
  version,
  laeuft,
  onNeuRechnen,
}: {
  version: KalkulationsAnsicht["version"];
  laeuft: Lauf | null;
  onNeuRechnen: () => void;
}) {
  if (!version.fehler && !version.veraltet) return null;
  const entwurf = version.status === "entwurf";
  const rechnet = laeuft === "neu_rechnen";
  // Ohne Montage-Echo (M9): eigener Text, kein „Neu rechnen“, das wäre eine Schleife mit dem alten Rechner.
  const rechnerAlt = !version.fehler && version.veraltetGrund === "rechner";
  return (
    <div className="kalk-band" data-ton={version.fehler ? "rose" : "gold"} role="status">
      <span>
        {version.fehler
          ? `Der Rechner hat nicht geantwortet: ${version.fehler}`
          : rechnerAlt
            ? "Der Rechner ist noch nicht auf dem neuen Stand. Sperren geht nach dem Rechner-Update."
            : "Der Entwurf ist veraltet: Lead oder Datum haben sich seit der letzten Berechnung geändert. Vor dem Sperren neu rechnen."}
      </span>
      {entwurf && !rechnerAlt ? (
        <button type="button" className="kalk-kleinknopf" disabled={laeuft !== null} aria-busy={rechnet || undefined} onClick={onNeuRechnen}>
          {rechnet ? "Rechnet …" : "Neu rechnen"}
        </button>
      ) : null}
    </div>
  );
}

function Hinweis({ titel, text, children }: { titel: string; text: string; children: React.ReactNode }) {
  return (
    <GlassPanel variant="panel" className="kalk-hinweis" role="alert">
      <h1>{titel}</h1>
      <p>{text}</p>
      <div className="kalk-hinweis-aktion">{children}</div>
    </GlassPanel>
  );
}

function KalkSkelett({ erstellen }: { erstellen: boolean }) {
  return (
    <div className="kalk-skelett" aria-busy="true" aria-label={erstellen ? "Kalkulation wird erstellt" : "Kalkulation wird geladen"}>
      <div className="kalk-skelett-kopf">
        <span className="lg-skeleton kalk-skelett-krume" />
        <span className="lg-skeleton kalk-skelett-titel" />
        <span className="lg-skeleton kalk-skelett-zweite" />
      </div>
      {erstellen ? (
        <div className="kalk-band" data-ton="blau" role="status">
          <span>Kalkulation wird erstellt …</span>
        </div>
      ) : null}
      <div className="kalk-spalten">
        <span className="lg-skeleton kalk-skelett-panel" />
        <span className="lg-skeleton kalk-skelett-panel" />
        <span className="lg-skeleton kalk-skelett-panel" />
      </div>
    </div>
  );
}
