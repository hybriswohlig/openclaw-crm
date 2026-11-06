/**
 * Reine Logik der neuen Inbox-Oberfläche (Plan 6, Task C): Schlüssel in der
 * URL, Texte der Schnellaktionen, Unterzeilen am Handy, Kurzform der Pillen,
 * clientseitiger Filter über die geladene Liste. Keine React-Abhängigkeit.
 * Anzeige deutsch, Trenner „·“, keine Gedankenstriche.
 */
import { SUCHE_MIN_ZEICHEN, filtern, type InboxChip, type InboxChips, type InboxEintrag, type InboxFilter, type Kurzfassung } from "@/lib/inbox-neu";
import { renderSnippet } from "@/components/inbox/customer-link-composer";

// ─── Schlüssel und URLs ───────────────────────────────────────────────────────

export type Schluessel = { art: "deal"; id: string } | { art: "gespraech"; id: string };

/** `deal:{id}` oder `gespraech:{id}` aus `InboxEintrag.key` bzw. `?e=`; sonst null. */
export function schluesselAus(key: string | null | undefined): Schluessel | null {
  if (!key) return null;
  const trenner = key.indexOf(":");
  if (trenner <= 0) return null;
  const art = key.slice(0, trenner);
  const id = key.slice(trenner + 1).trim();
  if (id === "") return null;
  if (art === "deal" || art === "gespraech") return { art, id };
  return null;
}

/** Route, die das Gespräch eines Eintrags liefert (Form `Gespraech`). */
export function gespraechUrl(s: Schluessel): string {
  return s.art === "deal"
    ? `/api/v1/deals/${encodeURIComponent(s.id)}/gespraech`
    : `/api/v1/inbox/gespraeche/${encodeURIComponent(s.id)}`;
}

/** `/app/inbox` mit der Auswahl in `?e=`. */
export function inboxUrl(key: string | null): string {
  return key ? `/app/inbox?e=${encodeURIComponent(key)}` : "/app/inbox";
}

/** Erster Eintrag der Hauptgruppe (Vorgabe am Desktop ohne `?e=`). */
export function ersterHaupt(eintraege: readonly InboxEintrag[]): string | null {
  return eintraege.find((e) => e.gruppe === "haupt")?.key ?? null;
}

// ─── Schnellaktionen ──────────────────────────────────────────────────────────

/** Texte, die nur ins Antwortfeld wandern, nie direkt gesendet werden (Entscheidung 11). */
export const SCHNELLAKTION_TEXT = {
  termin:
    "Wann würde Ihnen der Umzug passen? Nennen Sie mir gern zwei, drei Wunschtermine, dann prüfe ich, was frei ist.",
  fotos:
    "Könnten Sie mir bitte noch ein paar Fotos der Räume und größeren Möbel schicken? Dann kann ich Ihnen das genau durchrechnen.",
} as const;

/** Anreden und Titel, die kein Vorname sind: dann „Hallo,“ ohne Namen. */
const KEIN_VORNAME = new Set(["familie", "fam.", "herr", "frau", "hr.", "fr.", "dr.", "prof.", "firma", "fa."]);

/** Vorname aus dem Anzeigenamen wie in der alten Inbox (erstes Wort), ohne Anreden und Titel. */
export function vornameAus(name: string | null | undefined): string | null {
  const erstes = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (erstes === "" || erstes.startsWith("+") || /^\d/.test(erstes)) return null;
  if (KEIN_VORNAME.has(erstes.toLowerCase())) return null;
  return erstes;
}

export type LinkAntwort = { url: string | null; dealNumber?: string | null; skipped?: boolean };

export type LinkFolge = { art: "text"; text: string } | { art: "hinweis"; text: string };

/**
 * „Link erneut senden“: aus der Antwort von `POST /customer-link/{deal}` den
 * Baustein `kva_available` bauen; bei `skipped` oder ohne URL ein Hinweis.
 */
export function linkFolge(antwort: LinkAntwort, kurz: Pick<Kurzfassung, "name" | "kunde">): LinkFolge {
  if (antwort.skipped) return { art: "hinweis", text: "Kunden-Portal ist für diese Firma aus." };
  if (!antwort.url) return { art: "hinweis", text: "Noch kein Link. Zuerst einen Kostenvoranschlag speichern." };
  return {
    art: "text",
    text: renderSnippet("kva_available", {
      url: antwort.url,
      firmaName: kurz.kunde.firma ?? "wir",
      customerFirstName: vornameAus(kurz.name),
      dealNumber: antwort.dealNumber ?? null,
    }),
  };
}

// ─── Texte ────────────────────────────────────────────────────────────────────

/** Kopf-Unterzeile am Handy: „4 warten auf uns · 7 ungelesen“. */
export function handyUnterzeile(chips: InboxChips): string {
  const warten = chips.wartenAufUns === 1 ? "1 wartet auf uns" : `${chips.wartenAufUns} warten auf uns`;
  return `${warten} · ${chips.ungelesen} ungelesen`;
}

/** Unterzeile im Listenkopf: „11 Gespräche“, „1 Gespräch“, „Keine Gespräche“. */
export function listenUnterzeile(anzahl: number, abgeschnitten: boolean): string {
  const text = anzahl === 0 ? "Keine Gespräche" : anzahl === 1 ? "1 Gespräch" : `${anzahl} Gespräche`;
  return abgeschnitten ? `${text} · nur die neuesten 500` : text;
}

/** Unterzeile im Gesprächskopf: „{Stufe} · {Quelle} · {Wartet}“; ohne Deal „{Lane oder Ohne Deal} · {Quelle}“. */
export function gespraechUnterzeile(
  eintrag: Pick<InboxEintrag, "stufe" | "laneText" | "kleinanzeigen" | "wartet" | "dealId"> | null,
  kurz: Pick<Kurzfassung, "stufe" | "kunde"> | null
): string {
  const teile: string[] = [];
  const stufe = kurz?.stufe.label ?? eintrag?.stufe?.label ?? null;
  if (stufe) teile.push(stufe);
  else if (eintrag?.laneText) teile.push(eintrag.laneText);
  else if (eintrag && !eintrag.dealId) teile.push("Ohne Deal");
  const quelle = kurz?.kunde.quelle ?? (eintrag?.kleinanzeigen ? "Kleinanzeigen" : null);
  if (quelle && quelle !== "–") teile.push(quelle);
  if (eintrag?.wartet.text) teile.push(eintrag.wartet.text);
  return teile.join(" · ");
}

/** Kurzform der Pillen am Handy (Mockup): „wartet · 35 Min“, „Kunde · 2 Tage“, „KV ungesehen“, „Nachfass“. */
export function kompaktPille(text: string): string {
  if (text.startsWith("wartet auf uns")) return text.replace("wartet auf uns", "wartet");
  if (text.startsWith("wartet auf Kunden")) return text.replace("wartet auf Kunden", "Kunde");
  if (text.startsWith("KV ungesehen")) return "KV ungesehen";
  if (text === "KI-Entwurf · Nachfass") return "Nachfass";
  return text;
}

/** Die Chips „Jetzt“ (Entscheidung 6) mit Zähler aus `InboxChips`. */
export const CHIPS: readonly { key: Exclude<InboxChip, null>; label: string; kurz: string; ton: "blau" | "gold" | "grau" }[] = [
  { key: "ungelesen", label: "ungelesen", kurz: "Ungelesen", ton: "blau" },
  { key: "warten", label: "warten auf uns", kurz: "Wartet auf uns", ton: "gold" },
  { key: "ki", label: "KI-Entwürfe zur Freigabe", kurz: "KI-Entwürfe", ton: "blau" },
  { key: "info", label: "Info / Kein Lead", kurz: "Info", ton: "grau" },
];

export function chipZahl(chips: InboxChips, key: Exclude<InboxChip, null>): number {
  switch (key) {
    case "ungelesen":
      return chips.ungelesen;
    case "warten":
      return chips.wartenAufUns;
    case "ki":
      return chips.kiEntwuerfe;
    case "info":
      return chips.infoKeinLead;
  }
}

// ─── Filter ───────────────────────────────────────────────────────────────────

/** Ab so vielen Zeichen sucht der Server (Entscheidung 7, `SUCHE_MIN_ZEICHEN` aus dem Vertrag). */
export function sucheAktiv(suche: string): boolean {
  return suche.trim().length >= SUCHE_MIN_ZEICHEN;
}

export interface Gefiltert {
  /** Was oben steht: die Hauptgruppe, bei Chip „Info“ oder Suche die Treffer selbst. */
  haupt: InboxEintrag[];
  /** Die eingeklappte Gruppe unten; leer bei Suche oder aktivem Chip. */
  info: InboxEintrag[];
}

/**
 * `filtern` aus dem Vertrag, danach in die zwei Gruppen der Liste geteilt:
 * ohne Chip und ohne Suche steht die Info-Gruppe eingeklappt unten; ein
 * aktiver Chip oder eine Suche zeigt nur noch eine Liste ohne Trenner.
 */
export function gruppieren(eintraege: readonly InboxEintrag[], f: InboxFilter): Gefiltert {
  const gefiltert = filtern([...eintraege], f);
  if (sucheAktiv(f.suche) || f.chip) return { haupt: gefiltert, info: [] };
  return { haupt: gefiltert.filter((e) => e.gruppe === "haupt"), info: gefiltert.filter((e) => e.gruppe === "info") };
}

export const FILTER_LEER: InboxFilter = { chip: null, kanal: null, firmaId: null, stufeId: null, nurWartet: false, suche: "" };

/** Beschriftung der Leisten-Pillen: Auswahl oder die neutrale Vorgabe. */
export const KANAL_WAHL: readonly { wert: InboxFilter["kanal"]; label: string }[] = [
  { wert: null, label: "Alle Kanäle" },
  { wert: "whatsapp", label: "WhatsApp" },
  { wert: "email", label: "E-Mail" },
  { wert: "kleinanzeigen", label: "Kleinanzeigen" },
  { wert: "sms", label: "SMS" },
];

// ─── Kurzfassung ──────────────────────────────────────────────────────────────

/** Stufen, in denen „Kein Lead“ die Stufe nicht mehr anfasst (Entscheidung 12). */
const STUFE_GESCHUETZT = new Set(["booked", "done_unpaid", "paid"]);

/** Ob „Kein Lead“ auch die Deal-Stufe setzen darf. */
export function keinLeadSetztStufe(kurz: Pick<Kurzfassung, "keinLeadStufeId" | "kategorie">): boolean {
  return kurz.keinLeadStufeId !== null && !(kurz.kategorie !== null && STUFE_GESCHUETZT.has(kurz.kategorie));
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

/**
 * Dunkle Tinten für die Kürzel, auf denen weiße Schrift 4,5:1 erreicht; kein
 * Vermilion und kein Gold (Orange ist Artwork, Gold heißt „wartet auf uns“).
 * Fester Hash über den Namen, damit die Farbe je Kontakt stabil bleibt.
 */
const AVATAR_FARBEN = ["#222224", "#0d6b4a", "#0054b3", "#5a3fd6", "#a8113a", "#0e6f86", "#3d4f6b"] as const;

/** Info und Kein Lead einheitlich grau (4,5:1 mit Weiß). */
export const AVATAR_GRAU = "#66666a";

export function avatarFarbe(name: string, gruppe: InboxEintrag["gruppe"]): string {
  if (gruppe === "info") return AVATAR_GRAU;
  let h = 0;
  for (const z of name) h = (h * 31 + z.codePointAt(0)!) >>> 0;
  return AVATAR_FARBEN[h % AVATAR_FARBEN.length]!;
}
