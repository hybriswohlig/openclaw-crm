/**
 * Testdaten des KV-Editors (Plan 6a): ein Deal „Alex Beispiel“ ohne echte Kundendaten,
 * Stände, Katalog und eine Quelle im Speicher, die Speichern, Drucken, Pushen, Konflikte
 * und Chat nachspielt. Für Komponententests, die Vorschau (`e2e/kv-editor-preview`) und die
 * Seite bis 6b. Kein Netz, keine Datenbank.
 */
import {
  KV_EDITOR_TEXT,
  KV_PREIS_ABWEICHUNG_TEXT,
  type KiAntwort,
  type KvAblehnung,
  type KvAenderung,
  type KvBasis,
  type KvChatBeitrag,
  type KvEditorAnsicht,
  type KvEditorFehler,
  type KvEditorFehlerDaten,
  type KvFeld,
  type KvKonflikt,
  type KvPerson,
  type KvStandDetail,
  type KvStandKopf,
  type KvUnterschiedZeile,
  type KvWert,
  type StandAnlegenEingabe,
} from "@/lib/kv-editor";
import type { ApiAntwort } from "@/components/neu/akte/api";
import type { KvEditorQuelle } from "./kv-editor-quelle";
import { feldTitel } from "./kv-editor-logik";
import { gleich, lokalePruefung, normiert, werteAusListe } from "./kv-formular-logik";

export const KV_SZENARIEN = [
  "standard",
  "druckt",
  "fehler",
  "preis",
  "veraltet",
  "annahme",
  "annahme-member",
  "konflikt",
  "kalkulation-neu",
  "kein-kv",
  "rekonstruiert",
  "quelle-ohne-stand",
  "ceylan",
  "ungeprueft",
  "ki-laeuft",
  "altbestand",
] as const;
export type KvSzenario = (typeof KV_SZENARIEN)[number];

export const DARIO: KvPerson = { id: "u_dario", name: "Dario" };
export const NURI: KvPerson = { id: "u_nuri", name: "Nuri" };
const DEAL = "deal_beispiel";

/** Feste Uhr der Testdaten: Mittwoch 18.11.2026, 14:30 Berlin. */
export const FIXTURE_JETZT = new Date("2026-11-18T13:30:00Z");

function feld(f: Omit<KvFeld, "abschnitt"> & { abschnitt?: KvFeld["abschnitt"] }): KvFeld {
  const bereich = f.schluessel.slice(0, f.schluessel.indexOf(":"));
  const abschnitt = f.abschnitt ?? (bereich === "kueche-leistung" ? "kueche" : (bereich as KvFeld["abschnitt"]));
  return { ...f, abschnitt };
}

/** Katalog Kottke (VPS, Umzug), als wären die Felder nach V1 freigegeben. */
export function basisVps(): KvBasis {
  return {
    renderer: "vps",
    felder: [
      feld({ schluessel: "uebersicht:termin:zeit", label: "Uhrzeit", art: "text", max: 120, basis: "ab 8:00 Uhr" }),
      feld({ schluessel: "uebersicht:auszug:details", label: "Auszug, Hinweis", art: "text", max: 300, basis: "3. OG ohne Aufzug" }),
      feld({ schluessel: "uebersicht:einzug:details", label: "Einzug, Hinweis", art: "text", max: 300, basis: "EG, Zufahrt über den Hof" }),
      feld({ schluessel: "uebersicht:umzugsgut:text", label: "Umzugsgut", art: "langtext", max: 500, basis: "ca. 28 m³ aus einer 2-Zimmer-Wohnung" }),
      feld({ schluessel: "leistungen:transport:notiz", gruppe: "Transport", label: "Notiz", art: "langtext", max: 500, basis: "" }),
      feld({ schluessel: "leistungen:transport:zustaendig", gruppe: "Transport", label: "Zuständig", art: "zustaendig", basis: "company", firmaWaehlbar: true }),
      feld({ schluessel: "leistungen:assembly:notiz", gruppe: "Möbelmontage", label: "Notiz", art: "langtext", max: 500, basis: "" }),
      feld({ schluessel: "leistungen:assembly:zustaendig", gruppe: "Möbelmontage", label: "Zuständig", art: "zustaendig", basis: "customer", firmaWaehlbar: false }),
      feld({ schluessel: "leistungen:parkingPickup:notiz", gruppe: "Halteverbot Auszug", label: "Notiz", art: "langtext", max: 500, basis: "Wir stellen die Schilder 3 Tage vorher auf." }),
      feld({ schluessel: "leistungen:parkingPickup:zustaendig", gruppe: "Halteverbot Auszug", label: "Zuständig", art: "zustaendig", basis: "company", firmaWaehlbar: true }),
      feld({ schluessel: "umzugsgut:inv_schrank:bezeichnung", gruppe: "Kleiderschrank 3-türig", label: "Bezeichnung", art: "text", max: 120, basis: "Kleiderschrank 3-türig" }),
      feld({ schluessel: "umzugsgut:inv_schrank:raum", gruppe: "Kleiderschrank 3-türig", label: "Raum", art: "text", max: 60, basis: "Schlafzimmer" }),
      feld({ schluessel: "umzugsgut:inv_schrank:notiz", gruppe: "Kleiderschrank 3-türig", label: "Notiz", art: "text", max: 300, basis: "" }),
      feld({ schluessel: "umzugsgut:inv_schrank:demontage", gruppe: "Kleiderschrank 3-türig", label: "Demontage", art: "zustaendig", basis: "company", firmaWaehlbar: true }),
      feld({ schluessel: "umzugsgut:inv_schrank:montage", gruppe: "Kleiderschrank 3-türig", label: "Montage", art: "zustaendig", basis: "customer", firmaWaehlbar: false }),
      feld({ schluessel: "umzugsgut:inv_sofa:bezeichnung", gruppe: "Sofa, 3-Sitzer", label: "Bezeichnung", art: "text", max: 120, basis: "Sofa, 3-Sitzer" }),
      feld({ schluessel: "umzugsgut:inv_sofa:raum", gruppe: "Sofa, 3-Sitzer", label: "Raum", art: "text", max: 60, basis: "Wohnzimmer" }),
      feld({ schluessel: "umzugsgut:inv_sofa:notiz", gruppe: "Sofa, 3-Sitzer", label: "Notiz", art: "text", max: 300, basis: "" }),
      feld({ schluessel: "bilder:att_flur:zeigen", gruppe: "Flur", label: "Im KV zeigen", art: "zeigen", basis: true, anhangId: "att_flur" }),
      feld({ schluessel: "bilder:att_keller:zeigen", gruppe: "Keller", label: "Im KV zeigen", art: "zeigen", basis: true, anhangId: "att_keller" }),
      feld({ schluessel: "vereinbarungen:text:text", label: "Ergänzende Vereinbarungen", art: "langtext", max: 2000, basis: "" }),
    ],
  };
}

/** Katalog Ceylan (CRM-Renderer). */
export function basisCrm(): KvBasis {
  return {
    renderer: "crm",
    felder: [
      feld({ schluessel: "anschreiben:einleitung:text", label: "Einleitung", art: "langtext", max: 2000, basis: "vielen Dank für Ihre Anfrage. Gern bieten wir Ihnen den Umzug wie folgt an." }),
      feld({ schluessel: "uebersicht:zusammenfassung:text", label: "Leistung", art: "langtext", max: 1000, basis: "Umzug von Kornwestheim nach Ludwigsburg mit Transporter und drei Helfern." }),
      feld({ schluessel: "bemerkungen:text:text", label: "Bemerkungen", art: "langtext", max: 2000, basis: "" }),
      feld({ schluessel: "anschreiben:schluss:text", label: "Schluss", art: "langtext", max: 2000, basis: "Wir freuen uns auf Ihre Rückmeldung." }),
    ],
  };
}

const ae = (schluessel: string, wert: KvWert, vorher: KvWert, von: KvPerson, am: string, quelle: "hand" | "ki" = "hand"): KvAenderung => ({
  schluessel,
  wert,
  vorher,
  quelle,
  von: von.id,
  am,
});

function kopf(k: Partial<KvStandKopf> & Pick<KvStandKopf, "id" | "nummer">): KvStandKopf {
  return {
    vorgaengerId: null,
    renderer: "vps",
    kalkulationVersion: 3,
    quelle: "hand",
    status: "fertig",
    fehler: null,
    aenderungen: [],
    offen: [],
    erstelltVon: DARIO,
    erstelltAm: "2026-11-18T12:10:00Z",
    gepushtVon: null,
    gepushtAm: null,
    aktuell: false,
    dealDocumentId: null,
    grundlageRekonstruiert: false,
    pruefung: null,
    ...k,
  };
}

const PRUEFUNG_OK = { erwartetCent: [162000, 48600], erlaubtCent: [0], preis: "ok" as const, fehlt: [], fremd: [] };

/** Die drei Grundstände: 1 Ausgang, 2 gepusht (aktuell), 3 Entwurf von Hand, neueste zuerst. */
function grundStaende(): KvStandKopf[] {
  const s1 = kopf({
    id: "st_1",
    nummer: 1,
    quelle: "ausgang",
    erstelltVon: null,
    erstelltAm: "2026-11-16T09:00:00Z",
    dealDocumentId: "doc_1",
    grundlageRekonstruiert: true,
    pruefung: PRUEFUNG_OK,
  });
  const l2 = [
    ae("uebersicht:termin:zeit", "ab 7:30 Uhr", "ab 8:00 Uhr", NURI, "2026-11-17T08:40:00Z"),
    ae("leistungen:transport:notiz", "Zwei Transporter, einer am Auszug, einer am Einzug.", "", NURI, "2026-11-17T08:40:00Z"),
  ];
  const s2 = kopf({
    id: "st_2",
    nummer: 2,
    vorgaengerId: "st_1",
    aenderungen: l2,
    erstelltVon: NURI,
    erstelltAm: "2026-11-17T08:40:00Z",
    gepushtVon: NURI,
    gepushtAm: "2026-11-18T12:50:00Z",
    aktuell: true,
    dealDocumentId: "doc_2",
    pruefung: PRUEFUNG_OK,
  });
  const l3 = [
    ...l2,
    ae("vereinbarungen:text:text", "Der Kunde räumt den Keller bis zum Vortag selbst leer.", "", DARIO, "2026-11-18T13:12:00Z", "ki"),
    ae("umzugsgut:inv_schrank:notiz", "Spiegeltür, extra polstern", "", DARIO, "2026-11-18T13:12:00Z", "ki"),
  ];
  const s3 = kopf({
    id: "st_3",
    nummer: 3,
    vorgaengerId: "st_2",
    quelle: "ki",
    aenderungen: l3,
    erstelltVon: DARIO,
    erstelltAm: "2026-11-18T13:12:00Z",
    pruefung: PRUEFUNG_OK,
  });
  return [s3, s2, s1];
}

interface Zustand {
  szenario: KvSzenario;
  basis: KvBasis;
  ansicht: KvEditorAnsicht;
  /** Neueste zuerst. */
  staende: KvStandKopf[];
  chat: KvChatBeitrag[];
  /** Stand-ID → Zeitpunkt (ms), ab dem der Druck fertig ist. */
  fertigAb: Map<string, number>;
  /** Stand-ID → Ergebnis des Drucks. */
  druckErgebnis: Map<string, "fertig" | "fehler" | "preis">;
  veraltetGemeldet: boolean;
  /** Nur lesend angezeigtes Umzugsgut ohne Lead-ID (Altbestand). */
  nurLesen: { name: string; raum: string | null }[];
}

function ansichtStart(staende: KvStandKopf[], felder: Partial<KvEditorAnsicht> = {}): KvEditorAnsicht {
  const aktuell = staende.find((s) => s.aktuell) ?? null;
  return {
    dealId: DEAL,
    kunde: "Alex Beispiel",
    firma: "kottke",
    staende,
    aktuellStandId: aktuell?.id ?? null,
    aktuellDokumentId: aktuell?.dealDocumentId ?? null,
    quotationVersionId: "qv_3",
    kalkulationVersion: 3,
    annahme: { aktiv: false, am: null, standNummer: null, aufhebenErlaubt: true },
    preis: { text: "Gesamtpreis 1.620 € aus Kalkulation v3", kalkulationUrl: `/app/leads/${DEAL}/kalkulation` },
    hinweis: null,
    offeneKonflikte: 0,
    ...felder,
  };
}

function zustandFuer(szenario: KvSzenario): Zustand {
  let basis = basisVps();
  let staende = grundStaende();
  let ansicht: Partial<KvEditorAnsicht> = {};
  const druckErgebnis = new Map<string, "fertig" | "fehler" | "preis">();
  let nurLesen: Zustand["nurLesen"] = [];
  switch (szenario) {
    case "druckt":
      staende[0] = { ...staende[0], status: "druckt", pruefung: { ...PRUEFUNG_OK, preis: "offen" } };
      break;
    case "fehler":
      staende[0] = { ...staende[0], status: "fehler", fehler: "Der Druckdienst hat nicht geantwortet (Zeitüberschreitung).", pruefung: null };
      break;
    case "preis":
      staende[0] = {
        ...staende[0],
        status: "fehler",
        fehler: KV_PREIS_ABWEICHUNG_TEXT,
        pruefung: { ...PRUEFUNG_OK, preis: "abweichung", fehlt: [162000], fremd: [126000] },
      };
      break;
    case "annahme":
      ansicht = { annahme: { aktiv: true, am: "2026-11-18T10:05:00Z", standNummer: 2, aufhebenErlaubt: true } };
      break;
    case "annahme-member":
      ansicht = { annahme: { aktiv: true, am: "2026-11-18T10:05:00Z", standNummer: 2, aufhebenErlaubt: false } };
      break;
    case "konflikt": {
      const s4: KvStandKopf = kopf({
        id: "st_4",
        nummer: 4,
        vorgaengerId: "st_2",
        quelle: "mitgewandert",
        kalkulationVersion: 4,
        aenderungen: [staende[1].aenderungen[1]],
        offen: [
          { aenderung: staende[1].aenderungen[0], art: "basis_geaendert", basisJetzt: "ab 9:00 Uhr", status: "offen" },
          {
            aenderung: ae("umzugsgut:inv_klavier:notiz", "Klavier mit Gurt", "", NURI, "2026-11-17T08:40:00Z"),
            art: "ziel_fehlt",
            basisJetzt: null,
            status: "offen",
          },
        ],
        erstelltVon: null,
        erstelltAm: "2026-11-18T13:20:00Z",
        aktuell: true,
        dealDocumentId: "doc_4",
        pruefung: PRUEFUNG_OK,
      });
      staende = [s4, ...staende.slice(1).map((s) => ({ ...s, aktuell: false }))];
      basis = { ...basis, felder: basis.felder.map((f) => (f.schluessel === "uebersicht:termin:zeit" ? { ...f, basis: "ab 9:00 Uhr" } : f)) };
      ansicht = { kalkulationVersion: 4, quotationVersionId: "qv_4", offeneKonflikte: 2, preis: { text: "Gesamtpreis 1.780 € aus Kalkulation v4", kalkulationUrl: `/app/leads/${DEAL}/kalkulation` } };
      break;
    }
    case "kalkulation-neu":
      ansicht = { kalkulationVersion: 4, quotationVersionId: "qv_4" };
      break;
    case "kein-kv":
      staende = [];
      ansicht = { hinweis: "kein_kv" };
      break;
    case "rekonstruiert":
      staende = [{ ...staende[2], aktuell: true }];
      ansicht = { hinweis: "rekonstruiert" };
      break;
    case "quelle-ohne-stand":
      staende = staende.map((s) => ({ ...s, aktuell: false }));
      ansicht = { hinweis: "quelle_ohne_stand", aktuellDokumentId: "doc_hand" };
      break;
    case "ceylan": {
      basis = basisCrm();
      const c1 = kopf({ id: "st_c1", nummer: 1, renderer: "crm", quelle: "neu", erstelltVon: NURI, aktuell: true, dealDocumentId: "doc_c1", erstelltAm: "2026-11-17T15:00:00Z" });
      const c2 = kopf({
        id: "st_c2",
        nummer: 2,
        renderer: "crm",
        vorgaengerId: "st_c1",
        aenderungen: [ae("bemerkungen:text:text", "Parkplatz vor dem Haus ist reserviert.", "", DARIO, "2026-11-18T13:00:00Z")],
        erstelltAm: "2026-11-18T13:00:00Z",
      });
      staende = [c2, c1];
      ansicht = { firma: "ceylan", preis: { text: "Gesamtpreis 2.140 € aus Kalkulation v3", kalkulationUrl: `/app/leads/${DEAL}/kalkulation` } };
      break;
    }
    case "ungeprueft":
      basis = { renderer: "vps", felder: [] };
      break;
    case "altbestand":
      basis = { ...basis, felder: basis.felder.filter((f) => !f.schluessel.startsWith("umzugsgut:")) };
      nurLesen = [
        { name: "Kleiderschrank 3-türig", raum: "Schlafzimmer" },
        { name: "Waschmaschine", raum: "Bad" },
      ];
      break;
    default:
      break;
  }
  const chat: KvChatBeitrag[] =
    staende.length > 0 && szenario !== "ceylan"
      ? [
          { nachrichtId: "ev_1", uebernommen: false, rolle: "nutzer", text: "Schreib rein, dass der Kunde den Keller selbst leer räumt, und dass der Schrank eine Spiegeltür hat.", am: "2026-11-18T13:10:00Z", von: DARIO.id, standId: "st_2" },
          {
            nachrichtId: "ev_2",
            uebernommen: true,
            rolle: "ki",
            text: "Ich habe den Hinweis zum Keller unter „Ergänzende Vereinbarungen“ und die Spiegeltür beim Kleiderschrank eingetragen.",
            am: "2026-11-18T13:10:20Z",
            von: DARIO.id,
            standId: "st_2",
            vorschlaege: [],
            abgelehnt: [],
          },
        ]
      : [];
  return {
    szenario,
    basis,
    ansicht: ansichtStart(staende, ansicht),
    staende,
    chat,
    fertigAb: new Map(),
    druckErgebnis,
    veraltetGemeldet: false,
    nurLesen,
  };
}

function ok<T>(data: T): ApiAntwort<T> {
  return { ok: true, data };
}

function fehler<C extends KvEditorFehler>(code: C, daten?: KvEditorFehlerDaten[C]): ApiAntwort<never> {
  const status = { NUR_MENSCH: 403, KEIN_KV: 404, UNGUELTIG: 400, STAND_VERALTET: 409, STAND_NICHT_FERTIG: 409, AKTUELL_GEAENDERT: 409, KALKULATION_NEU: 409, ANNAHME_AKTIV: 409, ANGABEN_FEHLEN: 400, VPS_FEHLER: 502, KI_FEHLER: 504, LAEUFT: 409, NUR_ADMIN: 403 }[code];
  return { ok: false, status, code, message: KV_EDITOR_TEXT[code], fehler: { code, message: KV_EDITOR_TEXT[code], ...(daten !== undefined ? { daten } : {}) } };
}

/** Preisverdacht der Testdaten (grob; der echte steht in `lib/kv-editor-anwenden.ts`, Aufgabe 1). */
function preisVerdachtGrob(text: string): boolean {
  return /€|\beuro\b|%|\b(rabatt|prozent|preis|kostenlos|gratis|zahlung|anzahlung)/i.test(text);
}

/** Neue Liste wie `listeFortschreiben` (vereinfacht für Testdaten). */
function fortschreiben(basis: KvBasis, vorher: readonly KvAenderung[], e: StandAnlegenEingabe, quelle: "hand" | "ki", am: string): KvAenderung[] {
  let liste = vorher.filter((a) => !e.zuruecksetzen.includes(a.schluessel));
  for (const s of e.setzen) {
    const f = basis.felder.find((x) => x.schluessel === s.schluessel);
    if (!f) continue;
    liste = liste.filter((a) => a.schluessel !== s.schluessel);
    if (!gleich(s.wert, f.basis)) liste.push(ae(s.schluessel, normiert(s.wert), f.basis, DARIO, am, quelle));
  }
  return liste;
}

function unterschied(basis: KvBasis, alt: readonly KvAenderung[], neu: readonly KvAenderung[]): KvUnterschiedZeile[] {
  const a = werteAusListe(basis, alt);
  const n = werteAusListe(basis, neu);
  const out: KvUnterschiedZeile[] = [];
  for (const f of basis.felder) {
    const k = f.schluessel;
    if (gleich(a[k], n[k])) continue;
    const art = gleich(n[k], f.basis) ? "zurueck" : alt.some((x) => x.schluessel === k) ? "geaendert" : "neu";
    out.push({ schluessel: k, abschnitt: f.abschnitt, gruppe: f.gruppe, label: f.label, vorher: a[k], nachher: n[k], art });
  }
  return out;
}

export interface FixtureOptionen {
  /** Wie lange ein Druck dauert (ms). Standard 4000; in Tests 0. */
  druckMs?: number;
  /** PDF-Adresse je Stand; ohne: null (die Mitte zeigt dann einen Platzhalter). */
  pdf?: (standId: string) => string | null;
  /** Antwortzeit der KI (ms). Standard 900. */
  kiMs?: number;
  /** Uhr (Tests). */
  jetzt?: () => Date;
}

export type FixtureQuelle = KvEditorQuelle;

const warte = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** Quelle im Speicher für ein Szenario. Jeder Aufruf liefert eine Kopie (kein geteilter Zustand). */
export function fixtureQuelle(szenario: KvSzenario = "standard", o: FixtureOptionen = {}): FixtureQuelle {
  const z = zustandFuer(szenario);
  const druckMs = o.druckMs ?? 4000;
  const kiMs = o.kiMs ?? 900;
  const jetzt = o.jetzt ?? (() => new Date());
  const kopie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

  function neuesterStand(): KvStandKopf | null {
    return z.staende[0] ?? null;
  }

  function aktualisieren(s: KvStandKopf) {
    if (s.status !== "druckt") return;
    const ab = z.fertigAb.get(s.id);
    if (ab === undefined || Date.now() < ab) return;
    const ergebnis = z.druckErgebnis.get(s.id) ?? "fertig";
    if (ergebnis === "fertig") Object.assign(s, { status: "fertig", pruefung: s.renderer === "vps" ? PRUEFUNG_OK : null });
    else if (ergebnis === "preis") Object.assign(s, { status: "fehler", fehler: KV_PREIS_ABWEICHUNG_TEXT, pruefung: { ...PRUEFUNG_OK, preis: "abweichung", fehlt: [162000], fremd: [126000] } });
    else Object.assign(s, { status: "fehler", fehler: "Der Druckdienst hat nicht geantwortet." });
  }

  function anlegen(vorgaenger: KvStandKopf, liste: KvAenderung[], quelle: KvStandKopf["quelle"]): KvStandKopf {
    const s = kopf({
      id: `st_${z.staende.length + 1}_${Date.now().toString(36)}`,
      nummer: Math.max(0, ...z.staende.map((x) => x.nummer)) + 1,
      vorgaengerId: vorgaenger.id,
      renderer: vorgaenger.renderer,
      kalkulationVersion: vorgaenger.kalkulationVersion,
      quelle,
      status: vorgaenger.renderer === "vps" ? "druckt" : "fertig",
      aenderungen: liste,
      erstelltVon: DARIO,
      erstelltAm: jetzt().toISOString(),
      pruefung: vorgaenger.renderer === "vps" ? { ...PRUEFUNG_OK, preis: "offen" } : null,
    });
    z.staende.unshift(s);
    z.ansicht.staende = z.staende;
    z.fertigAb.set(s.id, Date.now() + druckMs);
    return s;
  }

  function detail(s: KvStandKopf): KvStandDetail {
    const vorg = z.staende.find((x) => x.id === s.vorgaengerId);
    return {
      ...s,
      basis: z.basis,
      werte: werteAusListe(z.basis, s.aenderungen),
      unterschied: unterschied(z.basis, vorg?.aenderungen ?? [], s.aenderungen),
      ...(z.nurLesen.length > 0 ? { nurLesen: z.nurLesen } : {}),
    };
  }

  return {
    async ansicht() {
      z.staende.forEach(aktualisieren);
      return ok(kopie({ ...z.ansicht, staende: z.staende }));
    },

    async stand(id) {
      const s = z.staende.find((x) => x.id === id);
      if (!s) return fehler("KEIN_KV");
      aktualisieren(s);
      return ok(kopie(detail(s)));
    },

    pdfUrl: (id) => o.pdf?.(id) ?? null,

    async standAnlegen(e) {
      await warte(Math.min(400, kiMs));
      const vorg = z.staende.find((x) => x.id === e.vorgaengerId);
      if (!vorg) return fehler("KEIN_KV");
      const neu = neuesterStand();
      if (z.szenario === "veraltet" && !z.veraltetGemeldet) {
        // Nuri hat inzwischen gespeichert: anderer Wert für die Uhrzeit, neue Notiz beim Sofa.
        z.veraltetGemeldet = true;
        const liste = fortschreiben(
          z.basis,
          vorg.aenderungen,
          { vorgaengerId: vorg.id, setzen: [{ schluessel: "uebersicht:termin:zeit", wert: "ab 7:00 Uhr" }, { schluessel: "umzugsgut:inv_sofa:notiz", wert: "Füße abschrauben" }], zuruecksetzen: [] },
          "hand",
          jetzt().toISOString()
        ).map((a) => ({ ...a, von: NURI.id }));
        const s = anlegen(vorg, liste, "hand");
        Object.assign(s, { erstelltVon: NURI, status: "fertig", pruefung: PRUEFUNG_OK });
        return fehler("STAND_VERALTET", { neuester: kopie(s) });
      }
      if (neu && neu.id !== e.vorgaengerId) return fehler("STAND_VERALTET", { neuester: kopie(neu) });
      const werte: Record<string, KvWert> = {};
      for (const s of e.setzen) werte[s.schluessel] = s.wert;
      const lokal = lokalePruefung(z.basis, werte);
      const abgelehnt: { schluessel: string | null; grund: KvAblehnung }[] = Object.entries(lokal).map(([schluessel, grund]) => ({ schluessel, grund }));
      for (const s of e.setzen) {
        if (!z.basis.felder.some((f) => f.schluessel === s.schluessel)) abgelehnt.push({ schluessel: s.schluessel, grund: "UNBEKANNT" });
        else if (typeof s.wert === "string" && preisVerdachtGrob(s.wert)) abgelehnt.push({ schluessel: s.schluessel, grund: "PREIS" });
      }
      if (abgelehnt.length > 0) return fehler("UNGUELTIG", { abgelehnt });
      if (e.kiNachrichtId && z.chat.some((x) => x.nachrichtId === e.kiNachrichtId && x.uebernommen)) {
        return fehler("UNGUELTIG", { abgelehnt: [{ schluessel: null, grund: "NICHT_VORGESCHLAGEN" }] });
      }
      const quelle = e.kiNachrichtId ? "ki" : "hand";
      const s = anlegen(vorg, fortschreiben(z.basis, vorg.aenderungen, e, quelle, jetzt().toISOString()), quelle);
      if (e.kiNachrichtId) {
        const c = z.chat.find((x) => x.nachrichtId === e.kiNachrichtId);
        if (c) c.uebernommen = true;
      }
      if (z.szenario === "preis") z.druckErgebnis.set(s.id, "preis");
      return ok(kopie(s));
    },

    async neuDrucken(id) {
      const vorg = z.staende.find((x) => x.id === id);
      if (!vorg) return fehler("KEIN_KV");
      const s = anlegen(vorg, kopie(vorg.aenderungen), vorg.quelle === "ki" ? "ki" : "hand");
      s.erstelltVon = DARIO;
      return ok(kopie(s));
    },

    async pushen(id, e) {
      await warte(Math.min(400, kiMs));
      const s = z.staende.find((x) => x.id === id);
      if (!s) return fehler("KEIN_KV");
      aktualisieren(s);
      if (s.status !== "fertig" || (s.pruefung && s.pruefung.preis !== "ok")) return fehler("STAND_NICHT_FERTIG", { status: s.status });
      if (s.gepushtAm) return fehler("UNGUELTIG", undefined);
      if (z.szenario === "kalkulation-neu") return fehler("KALKULATION_NEU", { kalkulationVersion: 4 });
      if (e.erwartetAktuellDokumentId !== z.ansicht.aktuellDokumentId) {
        const a = z.staende.find((x) => x.aktuell) ?? null;
        return fehler("AKTUELL_GEAENDERT", { aktuellStandNummer: a?.nummer ?? null, gepushtVon: a?.gepushtVon?.name ?? null });
      }
      if (z.ansicht.annahme.aktiv && !e.annahmeAufhebenBestaetigt) return fehler("ANNAHME_AKTIV", { am: z.ansicht.annahme.am, standNummer: z.ansicht.annahme.standNummer });
      if (z.ansicht.annahme.aktiv && !z.ansicht.annahme.aufhebenErlaubt) return fehler("NUR_ADMIN");
      const aufgehoben = z.ansicht.annahme.aktiv;
      for (const x of z.staende) x.aktuell = false;
      const doc = `doc_${s.nummer}`;
      Object.assign(s, { aktuell: true, gepushtVon: DARIO, gepushtAm: jetzt().toISOString(), dealDocumentId: doc });
      z.ansicht = { ...z.ansicht, aktuellStandId: s.id, aktuellDokumentId: doc, annahme: { ...z.ansicht.annahme, aktiv: false, am: null, standNummer: null }, hinweis: null };
      return ok({ stand: kopie(s), dealDocumentId: doc, annahmeAufgehoben: aufgehoben });
    },

    async konflikte(e) {
      const s = z.staende.find((x) => x.id === e.standId);
      if (!s) return fehler("KEIN_KV");
      const uebernehmen: KvKonflikt[] = [];
      for (const ent of e.entscheidungen) {
        const k = s.offen.find((x) => x.aenderung.schluessel === ent.schluessel && x.status === "offen");
        if (!k) continue;
        k.status = ent.aktion === "uebernehmen" ? "uebernommen" : "verworfen";
        k.entschiedenVon = DARIO.id;
        k.entschiedenAm = jetzt().toISOString();
        if (ent.aktion === "uebernehmen") uebernehmen.push(k);
      }
      z.ansicht.offeneKonflikte = s.offen.filter((k) => k.status === "offen").length;
      let neuerEntwurf: KvStandKopf | null = null;
      if (uebernehmen.length > 0) {
        const liste = fortschreiben(z.basis, s.aenderungen, { vorgaengerId: s.id, setzen: uebernehmen.map((k) => ({ schluessel: k.aenderung.schluessel, wert: k.aenderung.wert })), zuruecksetzen: [] }, "hand", jetzt().toISOString());
        neuerEntwurf = anlegen(s, liste, "hand");
      }
      return ok({ stand: kopie(s), neuerEntwurf: neuerEntwurf ? kopie(neuerEntwurf) : null });
    },

    async uebertragen(id) {
      const vorg = z.staende.find((x) => x.id === id);
      if (!vorg) return fehler("KEIN_KV");
      const s = anlegen(vorg, kopie(vorg.aenderungen), "hand");
      s.kalkulationVersion = z.ansicht.kalkulationVersion;
      z.ansicht.hinweis = null;
      return ok(kopie(s));
    },

    async chat(e) {
      await warte(kiMs);
      if (z.szenario === "ki-laeuft") return fehler("LAEUFT");
      const am = jetzt().toISOString();
      z.chat.push({ nachrichtId: `ev_${z.chat.length + 1}_${Date.now().toString(36)}`, uebernommen: false, rolle: "nutzer", text: e.text, am, von: DARIO.id, standId: e.standId });
      const nachrichtId = `ev_${z.chat.length + 1}_${Date.now().toString(36)}`;
      let antwort: KiAntwort;
      const s = z.staende.find((x) => x.id === e.standId);
      const werte = werteAusListe(z.basis, s?.aenderungen ?? []);
      if (preisVerdachtGrob(e.text)) {
        antwort = { antwort: "Preise und Rabatte ändere ich nicht. Den Preis änderst du in der Kalkulation.", vorschlaege: [], abgelehnt: [{ schluessel: null, grund: "PREIS" }], nachrichtId };
      } else if (z.basis.felder.length === 0) {
        antwort = { antwort: "In diesem KV sind noch keine Felder freigegeben.", vorschlaege: [], abgelehnt: [{ schluessel: null, grund: "LEER" }], nachrichtId };
      } else {
        const ziele =
          z.basis.renderer === "crm"
            ? [{ schluessel: "bemerkungen:text:text", wert: "Bitte am Umzugstag die Parkplätze vor dem Haus freihalten." }]
            : [
                { schluessel: "uebersicht:termin:zeit", wert: "ab 8:30 Uhr" },
                { schluessel: "umzugsgut:inv_sofa:notiz", wert: "Füße vorher abschrauben" },
              ];
        const vorschlaege: KiAntwort["vorschlaege"] = [];
        for (const v of ziele) {
          const f = z.basis.felder.find((x) => x.schluessel === v.schluessel);
          if (!f) continue;
          const vorher = werte[f.schluessel];
          vorschlaege.push({ schluessel: f.schluessel, abschnitt: f.abschnitt, gruppe: f.gruppe, label: f.label, vorher, nachher: v.wert, wert: v.wert, art: gleich(vorher, f.basis) ? "neu" : "geaendert" });
        }
        antwort = {
          antwort: `Ich schlage ${vorschlaege.length === 1 ? "eine Änderung" : `${vorschlaege.length} Änderungen`} vor: ${vorschlaege.map((v) => feldTitel(v)).join(" und ")}.`,
          vorschlaege,
          abgelehnt: /montage/i.test(e.text) ? [{ schluessel: "leistungen:assembly:zustaendig", grund: "FIRMA_GESPERRT" }] : [],
          nachrichtId,
        };
      }
      z.chat.push({ nachrichtId, uebernommen: false, rolle: "ki", text: antwort.antwort, am: jetzt().toISOString(), von: DARIO.id, standId: e.standId, vorschlaege: antwort.vorschlaege, abgelehnt: antwort.abgelehnt });
      return ok(kopie(antwort));
    },

    async chatVerlauf() {
      return ok(kopie(z.chat));
    },
  };
}
