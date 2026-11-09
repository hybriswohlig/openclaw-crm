/**
 * Plan 15: was der Rechner still angenommen hat, lesbar gemacht. Rein, ohne
 * Datenbank und ohne Server-Importe. Interne Texte, kein Kundentext.
 *
 * - Bauteil 1: Kasten „Damit hat der Rechner gerechnet“ (Gruppen, Sprungziele)
 * - Bauteil 3: Positionen ohne Katalogtreffer mit Korrektur
 * - Bauteil 5: fehlende Adressen
 * - Bauteile 9, 12: Fahrt je Strecke mit Quelle und der Rechnung in Klartext
 * - Bauteil 11: Grund der Teamgröße
 */
import type { FahrtAufschluesselung, FahrtQuelle, RechnerErgebnis } from "@/services/rechner/client";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import { adresseFuerRoute, istAdresseGenau } from "./adresse-regel";
import type { AnnahmeGruppeKey, AnnahmeZeile, AnnahmenKasten, Groessenklasse, PositionOhneKatalog } from "./kalkulation-p15";
import { GROESSENKLASSE_TEXT } from "./kalkulation-p15";
import { positionSchluessel, wirksameUebersteuerungen, type PositionWert, type Uebersteuerung } from "./kalkulation-versionen";

const K1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const K2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const G = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

function text(w: unknown): string | null {
  return typeof w === "string" && w.trim() !== "" ? w.trim() : null;
}

// ─── Adressen ────────────────────────────────────────────────────────────────

/** Braucht der Auftrag eine Entladeadresse? Ja, sobald die Zielseite aktiv ist (Umzug, Transport). */
export function brauchtEntladeadresse(anfrage: RechnerAnfrage | null | undefined): boolean {
  const a = anfrage ?? {};
  const art = text(a.auftragsart);
  if (art === "entruempelung" || art === "kuechenmontage") return false;
  return a.nach_vorhanden === "on" || art === "umzug" || art === "transport" || art === null;
}

/** Fehlende Adressen der Anfrage (Bauteil 5). Eine Angabe aus dem Chat zählt als vorhanden. */
export function fehlendeAdressen(anfrage: RechnerAnfrage | null | undefined): { beladen: boolean; entladen: boolean } {
  const a = anfrage ?? {};
  return {
    beladen: adresseFuerRoute(a.von_adresse) === null,
    entladen: brauchtEntladeadresse(a) && adresseFuerRoute(a.nach_adresse) === null,
  };
}

export interface AdressInfo {
  /** Text, mit dem gerechnet wurde, oder null */
  text: string | null;
  quelle: "lead" | "chat" | "fehlt";
  /** Chat: KI oder Erkennung */
  chatQuelle?: "ki" | "erkennung" | null;
  /** Genau (Straße, Hausnummer, PLZ oder Ort); sonst rechnet Google von Ortsmitte zu Ortsmitte. */
  genau: boolean;
  /** Von der Kalkulation ins Lead geschrieben (Herkunft „Kalkulation, Name, Zeit“). */
  gesetzt?: { von: string; am: string } | null;
}

// ─── Fahrt je Strecke (Bauteile 9 und 12) ────────────────────────────────────

export type StreckenArt = "anfahrt" | "tour" | "rueckweg" | "rueckfahrt";

export interface FahrtStreckeAnsicht {
  key: string;
  art: StreckenArt;
  /** 1-basiert bei Tour und Rückweg */
  tour: number | null;
  von: string;
  nach: string;
  min: number;
  km: number;
  quelle: FahrtQuelle;
  /** „Google“, „ungefähr (nur PLZ)“, „von Hand“, „geschätzt“ */
  quelleText: string;
  /** true: keine echte Route, die Karte zeichnet eine gestrichelte Gerade */
  geschaetzt: boolean;
  /** Grundlage-Feld, mit dem sich diese Strecke übersteuern lässt */
  feld: "fahrt.anfahrt_min" | "fahrt.strecke_min" | "fahrt.rueckfahrt_min";
}

export interface FahrtAnsicht {
  strecken: FahrtStreckeAnsicht[];
  minJePerson: number;
  team: number | null;
  pufferProzent: number | null;
  /** „2,25 h je Person × 5 Personen + 10 % Puffer = 12,38 h“ */
  rechnung: string;
  /** Hinweis, wenn die Summe der Strecken nicht der gerechneten Fahrzeit entspricht (mehrere Fahrzeuge) */
  hinweis: string | null;
  punkte: { station: string | null; beladen: string | null; entladen: string | null };
}

function quelleText(q: FahrtQuelle, genau: boolean): string {
  switch (q) {
    case "google":
      return genau ? "Google" : "ungefähr (nur PLZ)";
    case "manuell":
      return "von Hand";
    case "ortsintern":
      return "geschätzt (im selben Ort)";
    case "angenommen":
      return "geschätzt";
    case "keine":
      return "keine Strecke";
  }
}

const STUNDEN = (min: number) => `${K2.format(min / 60)} h`;

/** Fahrt der Empfehlung je Strecke aus `fahrtAufschluesselung` (neuer Rechner); null ohne. */
export function fahrtAnsicht(e: RechnerErgebnis | null, anfrage: RechnerAnfrage | null): FahrtAnsicht | null {
  const f: FahrtAufschluesselung | null | undefined = e?.fahrtAufschluesselung;
  if (!e || !f) return null;
  const a = anfrage ?? {};
  const beladen = adresseFuerRoute(a.von_adresse);
  const entladen = adresseFuerRoute(a.nach_adresse);
  const genau = (t: unknown) => typeof t === "string" && istAdresseGenau(t);
  const beladenGenau = genau(a.von_adresse);
  const entladenGenau = entladen ? genau(a.nach_adresse) : beladenGenau;
  const ziel = entladen ? "Entladen" : "Beladen";
  const strecken: FahrtStreckeAnsicht[] = [];
  const zeile = (
    key: string,
    art: StreckenArt,
    tour: number | null,
    von: string,
    nach: string,
    s: FahrtAufschluesselung["anfahrt"],
    istGenau: boolean,
    feld: FahrtStreckeAnsicht["feld"]
  ) =>
    strecken.push({
      key,
      art,
      tour,
      von,
      nach,
      min: s.min,
      km: s.km,
      quelle: s.quelle,
      quelleText: quelleText(s.quelle, istGenau),
      geschaetzt: s.quelle !== "google",
      feld,
    });
  zeile("anfahrt", "anfahrt", null, "Station", "Beladen", f.anfahrt, beladenGenau, "fahrt.anfahrt_min");
  const touren = Math.max(1, f.fahrten);
  if (f.wege > 0) {
    for (let t = 1; t <= touren; t++) {
      zeile(`tour.${t}`, "tour", t, "Beladen", "Entladen", f.strecke, beladenGenau && entladenGenau, "fahrt.strecke_min");
      if (t < touren) zeile(`rueckweg.${t}`, "rueckweg", t, "Entladen", "Beladen", f.strecke, beladenGenau && entladenGenau, "fahrt.strecke_min");
    }
  }
  zeile("rueckfahrt", "rueckfahrt", null, f.wege > 0 ? ziel : "Beladen", "Station", f.rueckfahrt, entladenGenau, "fahrt.rueckfahrt_min");

  const summe = f.anfahrt.min + f.wege * f.strecke.min + f.rueckfahrt.min;
  const team = e.team?.groesse ?? null;
  const puffer = e.kosten?.personalStunden?.pufferProzent ?? null;
  const minJePerson = f.fahrtMin;
  const gesamtH = team ? ((minJePerson * team) / 60) * (1 + (puffer ?? 0) / 100) : null;
  const rechnung =
    team && gesamtH !== null
      ? `${STUNDEN(minJePerson)} je Person × ${G.format(team)} ${team === 1 ? "Person" : "Personen"}${puffer ? ` + ${K1.format(puffer)} % Puffer` : ""} = ${K2.format(gesamtH)} h`
      : `${STUNDEN(minJePerson)} je Person`;
  return {
    strecken,
    minJePerson,
    team,
    pufferProzent: puffer,
    rechnung,
    hinweis:
      summe === minJePerson
        ? null
        : `Die Strecken ergeben ${G.format(summe)} min; gerechnet sind ${G.format(minJePerson)} min, weil ein Fahrzeug der Empfehlung länger fährt.`,
    punkte: { station: text(e.mietstation?.adresse), beladen, entladen },
  };
}

/** Unterzeilen unter „Fahrt“ in der Selbstkosten-Kette. */
export function fahrtUnterzeilen(f: FahrtAnsicht): { key: string; label: string; wert: string }[] {
  const zeilen = f.strecken.map((s) => ({
    key: `fahrt.${s.key}`,
    label: `${s.art === "tour" ? `Tour ${s.tour}: ` : s.art === "rueckweg" ? "Rückweg: " : ""}${s.von} → ${s.nach} · ${s.quelleText}`,
    wert: `${G.format(s.min)} min · ${K1.format(s.km)} km`,
  }));
  zeilen.push({ key: "fahrt.rechnung", label: `= ${f.rechnung}`, wert: "" });
  return zeilen;
}

// ─── Team (Bauteil 11) ───────────────────────────────────────────────────────

/** Warum das Team so groß ist, aus `team.quelle` und den Träger-Hinweisen. */
export function teamGrund(e: RechnerErgebnis | null): string | null {
  const team = e?.team;
  if (!team) return null;
  const n = team.groesse;
  switch (team.quelle) {
    case "traeger": {
      const t = (e?.hinweise ?? []).find((h) => h.typ === "traeger");
      const name = t?.text.split(":")[0]?.trim() ?? null;
      const pos = name ? (e?.positionen ?? []).find((p) => p.name.trim() === name) : undefined;
      const geschaetzt = pos?.ungeprueft ? `, geschätzt ${GROESSENKLASSE_TEXT[pos.groessenklasse ?? "mittel"]}` : "";
      return name ? `${n} Träger wegen ${name}${geschaetzt}` : `${n} Personen wegen eines Möbels mit Mindestträgern`;
    }
    case "staffel":
      return `${n} Personen nach Volumen (${K1.format(e?.volumen?.ladeCbm ?? e?.volumen?.nettoCbm ?? 0)} m³ Ladevolumen)`;
    case "arbeitstag":
      return `${n} Personen, damit der Auftrag an einem Arbeitstag zu schaffen ist`;
    case "fahrer":
      return `${n} Personen, je Fahrzeug ein Fahrer`;
    case "vorgabe":
      return `${n} Personen von Hand vorgegeben`;
    default:
      return null;
  }
}

// ─── Positionen ohne Katalogtreffer (Bauteil 3) ──────────────────────────────

export function positionenOhneKatalog(
  e: RechnerErgebnis | null,
  overrides: Uebersteuerung[],
  autorName: (u: Uebersteuerung) => string,
  zeitText: (iso: string) => string
): PositionOhneKatalog[] {
  const korrekturen = new Map(
    wirksameUebersteuerungen(overrides)
      .filter((u) => u.art === "position")
      .map((u) => [u.key, u] as const)
  );
  const aus = new Map<string, PositionOhneKatalog>();
  for (const p of e?.positionen ?? []) {
    if (!p.ungeprueft) continue;
    const key = positionSchluessel(p.name);
    const vorhanden = aus.get(key);
    if (vorhanden) {
      vorhanden.menge += p.menge;
      continue;
    }
    const u = korrekturen.get(key);
    const w = (u?.wert ?? null) as PositionWert | null;
    aus.set(key, {
      key,
      name: p.name.trim(),
      menge: p.menge,
      groessenklasse: (p.groessenklasse as Groessenklasse | undefined) ?? null,
      volumenCbm: Number.isFinite(p.volumenCbm) ? p.volumenCbm : null,
      gewichtKg: typeof p.gewichtKg === "number" ? p.gewichtKg : null,
      korrektur:
        u && w
          ? {
              ...(w.groessenklasse ? { groessenklasse: w.groessenklasse } : {}),
              ...(w.volumenCbm ? { volumenCbm: w.volumenCbm } : {}),
              ...(w.gewichtKg ? { gewichtKg: w.gewichtKg } : {}),
              grund: u.grund,
              von: autorName(u),
              am: zeitText(u.zeit),
            }
          : null,
    });
  }
  return [...aus.values()];
}

export function positionText(p: Pick<PositionOhneKatalog, "name" | "menge" | "groessenklasse" | "volumenCbm" | "gewichtKg">): string {
  const teile = [
    p.groessenklasse ? GROESSENKLASSE_TEXT[p.groessenklasse] : null,
    p.volumenCbm !== null ? `${K2.format(p.volumenCbm)} m³` : null,
    p.gewichtKg !== null ? `${G.format(p.gewichtKg)} kg` : null,
  ].filter(Boolean);
  return `${p.menge > 1 ? `${G.format(p.menge)} × ` : ""}${p.name}${teile.length > 0 ? `: ${teile.join(", ")}` : ""}`;
}

// ─── Kasten „Damit hat der Rechner gerechnet“ (Bauteil 1) ────────────────────

export interface KastenEingabe {
  ergebnis: RechnerErgebnis | null;
  anfrage: RechnerAnfrage | null;
  adressen: { beladen: AdressInfo; entladen: AdressInfo };
  fahrt: FahrtAnsicht | null;
  positionen: PositionOhneKatalog[];
  overrides: Uebersteuerung[];
}

const GRUPPEN_TITEL: Record<AnnahmeGruppeKey, string> = {
  adressen: "Adressen und Strecke",
  etagen: "Etagen, Tragweg, Aufzug",
  volumen: "Volumen",
  team: "Team",
  fahrzeit: "Fahrzeit",
  weitere: "Weitere Annahmen",
};

/** Annahmen-Texte des Rechners, die eine eigene Zeile im Kasten schon abdeckt (sonst doppelt). */
const ABGEDECKT = [
  /^Position ".*" (ohne Katalogtreffer|Katalogschlüssel)/,
  /^Fahrzeiten zur Mietstation unvollständig/,
  /^Strecke zwischen Belade- und Entladeadresse unbekannt/,
  /^Strecke Beladen → Entladen fehlt/,
  /^Route für Startort/,
  /^Ohne Fahrzeiten je Station/,
];

function rechnerAnnahmeGruppe(t: string): { gruppe: AnnahmeGruppeKey; ziel: string } {
  if (/Tragestrecke an der Beladeadresse|Etage an der Beladeadresse|Wendeltreppe an der Beladeadresse/.test(t)) return { gruppe: "etagen", ziel: "beladen" };
  if (/Tragestrecke an der Entladeadresse|Etage an der Entladeadresse|Wendeltreppe an der Entladeadresse/.test(t)) return { gruppe: "etagen", ziel: "entladen" };
  if (/Umzug innerhalb desselben Ortes|Anfahrt und Rückfahrt|Startort|Fahrzeit|Strecke/.test(t)) return { gruppe: "fahrzeit", ziel: "fahrt" };
  if (/Möbelliste|Volumen|Wohnfläche|Zimmer|Hausrat|Karton/.test(t)) return { gruppe: "volumen", ziel: "volumen" };
  return { gruppe: "weitere", ziel: "volumen" };
}

/** Kasten-Inhalt; null, wenn der Rechner nichts Nennenswertes angenommen hat. */
export function annahmenKasten(k: KastenEingabe): AnnahmenKasten | null {
  const e = k.ergebnis;
  const a = k.anfrage ?? {};
  if (!e) return null;
  const gruppen = new Map<AnnahmeGruppeKey, AnnahmeZeile[]>();
  const add = (g: AnnahmeGruppeKey, z: AnnahmeZeile) => gruppen.set(g, [...(gruppen.get(g) ?? []), z]);

  // Adressen und Strecke
  const fehlt = fehlendeAdressen(a);
  const chatSeiten = (["beladen", "entladen"] as const).filter((s) => k.adressen[s].quelle === "chat");
  if (chatSeiten.length > 0) {
    add("adressen", {
      text:
        chatSeiten.length === 2
          ? "Adressen aus dem Chat (PLZ), unbestätigt"
          : `${chatSeiten[0] === "beladen" ? "Beladeadresse" : "Entladeadresse"} aus dem Chat (PLZ), unbestätigt`,
      ziel: chatSeiten[0],
    });
  }
  if (fehlt.beladen) add("adressen", { text: "Beladeadresse fehlt: Fahrzeiten zur Station geschätzt", ziel: "beladen" });
  if (fehlt.entladen) add("adressen", { text: "Entladeadresse fehlt: Strecke Beladen → Entladen geschätzt", ziel: "entladen" });
  for (const s of ["beladen", "entladen"] as const) {
    const info = k.adressen[s];
    if (info.quelle === "lead" && info.text && !info.genau) {
      add("adressen", {
        text: `${s === "beladen" ? "Beladeadresse" : "Entladeadresse"} ohne Straße: Fahrzeiten ungefähr, von Ortsmitte zu Ortsmitte`,
        ziel: s,
      });
    }
  }

  // Fahrzeit
  if (k.fahrt) {
    for (const st of k.fahrt.strecken) {
      if (st.art === "rueckweg" || (st.art === "tour" && st.tour !== 1)) continue;
      if (st.quelle !== "angenommen" && st.quelle !== "ortsintern") continue;
      const wo = st.art === "anfahrt" ? "Anfahrt Station → Beladen" : st.art === "rueckfahrt" ? "Rückfahrt zur Station" : "Weg Beladen → Entladen";
      add("fahrzeit", { text: `${wo} geschätzt: ${G.format(st.min)} min${st.art === "tour" ? " je Weg" : ""}`, ziel: "fahrt" });
    }
  } else if (e.mietstation?.quelle === "angenommen") {
    add("fahrzeit", { text: "Fahrzeiten zur Station geschätzt", ziel: "fahrt" });
  }
  if (text(e.fahrzeitHinweis)) add("fahrzeit", { text: e.fahrzeitHinweis!.trim(), ziel: "fahrt" });

  // Volumen
  if (k.positionen.length > 0) {
    const offen = k.positionen.filter((p) => !p.korrektur);
    if (offen.length > 0) {
      add("volumen", {
        text: `${G.format(offen.length)} ${offen.length === 1 ? "Position" : "Positionen"} ohne Katalogtreffer: Volumen und Gewicht nach Größenklasse geschätzt`,
        ziel: "positionen",
        details: offen.map(positionText),
      });
    }
  }
  if (e.zeiten?.methode === "volumen") {
    const teile = (e.positionen ?? []).reduce((n, p) => n + p.menge, 0);
    const unbekannt = (e.positionen ?? []).filter((p) => p.ungeprueft).reduce((n, p) => n + p.menge, 0);
    add("volumen", {
      text: `Tragezeit pauschal nach Volumen, weil ${G.format(unbekannt)} von ${G.format(teile)} Teilen unbekannt`,
      ziel: "positionen",
    });
  }
  const kartonsErfasst =
    text(a.zimmer) !== null ||
    text(a.wohnflaeche_qm) !== null ||
    text(a.umzugskartons) !== null ||
    !!e.kartonSchaetzung ||
    (e.positionen ?? []).some((p) => /karton|kiste|umzugsbox/i.test(p.name));
  if (!kartonsErfasst && text(a.auftragsart) !== "kuechenmontage" && text(a.auftragsart) !== "transport") {
    add("volumen", { text: "Kartons und Kleinkram nicht erfasst (keine Zimmer, keine Wohnfläche, keine Kartons)", ziel: "umzugskartons" });
  }
  const umgedeutet = k.overrides.some((u) => u.art === "eingabe" && (u.key === "kartons" || u.umgedeutet === "kartons") && u.wert !== null);
  if (umgedeutet) add("volumen", { text: "Kartons wurden früher als Einpackservice gerechnet, bitte prüfen", ziel: "umzugskartons" });

  // Etagen, Tragweg und übrige Rechner-Annahmen
  const rechner = [...(e.annahmen ?? []), ...(e.schaetzung?.annahmen ?? [])];
  for (const t of [...new Set(rechner)]) {
    if (ABGEDECKT.some((r) => r.test(t))) continue;
    const { gruppe, ziel } = rechnerAnnahmeGruppe(t);
    add(gruppe, { text: t.replace(/\.$/, ""), ziel });
  }

  const nennenswert = gruppen.size > 0;
  // Team: der Grund steht immer im Kasten, sobald es ihn gibt (Bauteil 11).
  const grund = teamGrund(e);
  if (grund) add("team", { text: grund, ziel: "team" });
  if (!nennenswert && e.team?.quelle !== "traeger" && e.team?.quelle !== "arbeitstag") return null;

  const reihenfolge: AnnahmeGruppeKey[] = ["adressen", "fahrzeit", "etagen", "volumen", "team", "weitere"];
  return {
    gruppen: reihenfolge
      .filter((g) => gruppen.has(g))
      .map((g) => ({ key: g, titel: GRUPPEN_TITEL[g], zeilen: gruppen.get(g)! })),
  };
}
