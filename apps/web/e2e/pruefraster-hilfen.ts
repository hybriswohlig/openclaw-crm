import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

declare const __dirname: string;

export interface HellFund {
  beschreibung: string;
  farbe: string;
}

/** Wirft, wenn die URL nicht eindeutig auf 127.0.0.1 oder localhost zeigt. */
export function datenbankUrlPruefen(url: string): string {
  const roh = url.trim();
  const marke = "://";
  const start = roh.indexOf(marke);
  if (start < 0) {
    throw new Error("Abbruch: Datenbank-URL ist keine gültige URL.");
  }
  const rest = roh.slice(start + marke.length);
  const ende = rest.search(/[/?#]/);
  const autoritaet = ende === -1 ? rest : rest.slice(0, ende);
  const atZeichen = autoritaet.split("@").length - 1;
  if (autoritaet.includes(",") || atZeichen > 1) {
    throw new Error(
      "Abbruch: Datenbank-URL nennt mehrere Hosts oder mehrere @. Nur 127.0.0.1 oder localhost ist erlaubt."
    );
  }

  let geparst: URL;
  try {
    geparst = new URL(roh);
  } catch {
    throw new Error("Abbruch: Datenbank-URL ist keine gültige URL.");
  }
  const host = geparst.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `Abbruch: Datenbank-URL zeigt auf ${host || "keinen Host"}, nicht auf 127.0.0.1 oder localhost.`
    );
  }
  return roh;
}

type Sql = postgres.Sql;

async function mitDb<T>(url: string, arbeit: (sql: Sql) => Promise<T>): Promise<T> {
  const sicher = datenbankUrlPruefen(url);
  const sql = postgres(sicher, { max: 1 });
  try {
    return await arbeit(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Deal (a) ist der Datensatz mit Namenswert „Familie Weber“.
 * Die Person ist zuerst `associated_people` dieses Deals, sonst irgendein
 * lebender Datensatz des Objekts `people`. Gesetzte Umgebungsvariablen gewinnen.
 */
export async function kennungenLaden(url: string): Promise<{ deal: string; person: string | null }> {
  const dealOverride = process.env.PRUEFRASTER_DEAL?.trim() || null;
  const personRoh = process.env.PRUEFRASTER_PERSON;
  const personGesetzt = personRoh !== undefined;
  const personOverride = personRoh?.trim() || null;
  if (dealOverride && personGesetzt) {
    return { deal: dealOverride, person: personOverride };
  }

  return mitDb(url, async (sql) => {
    let deal = dealOverride;
    if (!deal) {
      const zeilen = await sql<{ id: string }[]>`
        SELECT r.id
        FROM records r
        JOIN objects o ON o.id = r.object_id
        JOIN record_values rv ON rv.record_id = r.id
        JOIN attributes a ON a.id = rv.attribute_id AND a.object_id = o.id
        WHERE o.slug = 'deals'
          AND a.slug = 'name'
          AND rv.text_value = 'Familie Weber'
          AND r.deleted_at IS NULL
        ORDER BY r.created_at
        LIMIT 1
      `;
      deal = zeilen[0]?.id ?? null;
      if (!deal) throw new Error('Deal „Familie Weber“ nicht gefunden.');
    }

    if (personGesetzt) return { deal, person: personOverride };

    const verknuepft = await sql<{ id: string }[]>`
      SELECT pr.id
      FROM record_values rv
      JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'associated_people'
      JOIN records pr ON pr.id = rv.referenced_record_id AND pr.deleted_at IS NULL
      JOIN objects po ON po.id = pr.object_id AND po.slug = 'people'
      WHERE rv.record_id = ${deal}
      ORDER BY rv.sort_order
      LIMIT 1
    `;
    if (verknuepft[0]) return { deal, person: verknuepft[0].id };

    const irgendwer = await sql<{ id: string }[]>`
      SELECT r.id
      FROM records r
      JOIN objects o ON o.id = r.object_id AND o.slug = 'people'
      WHERE r.deleted_at IS NULL
      ORDER BY r.created_at
      LIMIT 1
    `;
    return { deal, person: irgendwer[0]?.id ?? null };
  });
}

/** Plan 15: Deal mit Fahrt-Popup aus `scripts/akte-testdaten.ts` („Viktoria Muster (Chat)“), sonst null. */
export async function fahrtDealLaden(url: string): Promise<string | null> {
  return mitDb(url, async (sql) => {
    const zeilen = await sql<{ id: string }[]>`
      SELECT r.id
      FROM records r
      JOIN objects o ON o.id = r.object_id AND o.slug = 'deals'
      JOIN record_values rv ON rv.record_id = r.id
      JOIN attributes a ON a.id = rv.attribute_id AND a.object_id = o.id AND a.slug = 'name'
      WHERE rv.text_value = 'Viktoria Muster (Chat)' AND r.deleted_at IS NULL
      LIMIT 1
    `;
    return zeilen[0]?.id ?? null;
  });
}

/** Token der Kundenstatus-Seite für Deal (a). Widerrufene Links zählen nicht. */
export async function portalTokenLaden(url: string, deal: string): Promise<string | null> {
  return mitDb(url, async (sql) => {
    const zeilen = await sql<{ token: string }[]>`
      SELECT token
      FROM customer_status_links
      WHERE deal_record_id = ${deal}
        AND revoked_at IS NULL
      LIMIT 1
    `;
    return zeilen[0]?.token ?? null;
  });
}

function tagesOrdner(): string {
  const jetzt = new Date();
  const monat = String(jetzt.getMonth() + 1).padStart(2, "0");
  const tag = String(jetzt.getDate()).padStart(2, "0");
  return `${jetzt.getFullYear()}-${monat}-${tag}`;
}

function repoWurzel(): string {
  return path.resolve(__dirname, "../../..");
}

/** `PRUEFRASTER_AUSGABE` oder `<repo>/.superpowers/pruefraster/<lokales Datum>`. */
export function ausgabeOrdner(): string {
  const ordner = process.env.PRUEFRASTER_AUSGABE?.trim() || path.join(repoWurzel(), ".superpowers", "pruefraster", tagesOrdner());
  fs.mkdirSync(ordner, { recursive: true });
  return ordner;
}

/** Läuft in der Seite: true, wenn nichts seitlich überläuft. */
export function pruefSkriptHorizontalScroll(): boolean {
  return document.documentElement.scrollWidth <= window.innerWidth;
}

/** Läuft in der Seite: `data-lg-theme` am html-Element. */
export function pruefSkriptLgTheme(): string | null {
  return document.documentElement.getAttribute("data-lg-theme");
}

/**
 * Läuft in der Seite. Sichtbare, deckende, sehr helle Flächen unter `[data-neu]`,
 * außer in `.neu-hell-fest`. Höchstens 50 Treffer.
 */
export function pruefSkriptHelleFlaechen(): HellFund[] {
  function farbeLesen(wert: string): { r: number; g: number; b: number; a: number } | null {
    const treffer = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(wert.trim());
    if (!treffer) return null;
    const r = Number(treffer[1]);
    const g = Number(treffer[2]);
    const b = Number(treffer[3]);
    const a = treffer[4] === undefined ? 1 : Number(treffer[4]);
    if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
    return { r, g, b, a };
  }

  function sichtbar(el: Element): boolean {
    let knoten: Element | null = el;
    while (knoten) {
      const stil = getComputedStyle(knoten);
      if (stil.display === "none" || stil.visibility === "hidden" || stil.visibility === "collapse") return false;
      if (Number(stil.opacity) === 0) return false;
      knoten = knoten.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function beschreibung(el: Element): string {
    const teile: string[] = [];
    let knoten: Element | null = el;
    for (let i = 0; i < 4 && knoten; i++) {
      const id = knoten.id ? `#${knoten.id}` : "";
      const klassen = [...knoten.classList]
        .slice(0, 2)
        .map((klasse) => `.${klasse}`)
        .join("");
      teile.unshift(`${knoten.tagName.toLowerCase()}${id}${klassen}`);
      if (knoten.id || knoten.hasAttribute("data-neu")) break;
      knoten = knoten.parentElement;
    }
    return teile.join(" > ");
  }

  const funde: HellFund[] = [];
  const knoten = document.querySelectorAll("[data-neu], [data-neu] *");
  for (const el of knoten) {
    if (funde.length >= 50) break;
    if (el.closest(".neu-hell-fest")) continue;
    // Plan 14b: Knöpfe von Schalter und Regler bleiben weiß (wie iOS dunkel); Punkte und
    // Marker unter 16 × 16 px sind Zeichen in --ink, keine Flächen.
    if (el.matches(".lg-switch-thumb, .lg-slider-thumb")) continue;
    const masse = el.getBoundingClientRect();
    if (masse.width < 16 && masse.height < 16) continue;
    if (!sichtbar(el)) continue;
    const farbe = getComputedStyle(el).backgroundColor;
    const gelesen = farbeLesen(farbe);
    if (!gelesen || gelesen.a <= 0.5) continue;
    if (gelesen.r > 0xe0 && gelesen.g > 0xe0 && gelesen.b > 0xe0) {
      funde.push({ beschreibung: beschreibung(el), farbe });
    }
  }
  return funde;
}

export interface KontrastFund {
  beschreibung: string;
  text: string;
  farbe: string;
  grund: string;
  kontrast: number;
}

/**
 * Läuft in der Seite (Plan 14b). Sichtbarer Text unter `[data-neu]` mit Kontrast unter 4,5:1
 * gegen den Hintergrund, der sich aus allen Vorfahren ergibt (halbtransparente Flächen werden
 * über `grundFarbe` geschichtet; Glas ohne Unschärfe, also eine Näherung). Großer Text
 * (ab 24 px oder ab 18,66 px fett) braucht 3:1. Elemente in `.neu-hell-fest`, Bilder, Karten
 * (`.maplibregl-map`) und deaktivierte Bedienelemente zählen nicht. Höchstens 60 Treffer.
 */
export function pruefSkriptKontrast(grundFarbe: string): KontrastFund[] {
  type Rgba = { r: number; g: number; b: number; a: number };
  function lesen(wert: string): Rgba | null {
    const t = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(wert.trim());
    if (t) {
      const a = t[4] === undefined ? 1 : t[4].endsWith("%") ? Number(t[4].slice(0, -1)) / 100 : Number(t[4]);
      return { r: Number(t[1]), g: Number(t[2]), b: Number(t[3]), a };
    }
    const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i.exec(wert.trim());
    if (srgb) {
      return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
    }
    return null;
  }
  function ueber(v: Rgba, g: Rgba): Rgba {
    return { r: v.r * v.a + g.r * (1 - v.a), g: v.g * v.a + g.g * (1 - v.a), b: v.b * v.a + g.b * (1 - v.a), a: 1 };
  }
  function leucht(c: Rgba): number {
    const k = (x: number) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * k(c.r) + 0.7152 * k(c.g) + 0.0722 * k(c.b);
  }
  function kontrast(a: Rgba, b: Rgba): number {
    const [x, y] = [leucht(a), leucht(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  function text(c: Rgba): string {
    return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  }
  function beschreibung(el: Element): string {
    const teile: string[] = [];
    let k: Element | null = el;
    for (let i = 0; i < 4 && k; i++) {
      const klassen = [...k.classList].slice(0, 2).map((c) => `.${c}`).join("");
      teile.unshift(`${k.tagName.toLowerCase()}${k.id ? `#${k.id}` : ""}${klassen}`);
      if (k.id || k.hasAttribute("data-neu")) break;
      k = k.parentElement;
    }
    return teile.join(" > ");
  }
  const grund = lesen(grundFarbe) ?? { r: 28, g: 28, b: 30, a: 1 };
  const funde: KontrastFund[] = [];
  const gesehen = new Set<string>();
  const laeufer = document.createTreeWalker(document.querySelector("[data-neu]") ?? document.body, NodeFilter.SHOW_TEXT);
  for (let n = laeufer.nextNode(); n && funde.length < 60; n = laeufer.nextNode()) {
    const inhalt = (n.textContent ?? "").trim();
    if (!inhalt) continue;
    const el = n.parentElement;
    if (!el || el.closest(".neu-hell-fest, .maplibregl-map, [disabled], [aria-disabled='true'], [aria-hidden='true']")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const stil = getComputedStyle(el);
    if (stil.visibility !== "visible" || Number(stil.opacity) < 0.5) continue;
    const farbe = lesen(stil.color);
    if (!farbe) continue;
    // Hintergrund: von oben (Seite) nach unten (Element) schichten; Verläufe und Bilder abbrechen.
    const kette: Element[] = [];
    for (let k: Element | null = el; k; k = k.parentElement) kette.unshift(k);
    let bg = grund;
    let unklar = false;
    for (const k of kette) {
      const ks = getComputedStyle(k);
      if (Number(ks.opacity) < 1 && k !== el) unklar = true;
      if (ks.backgroundImage && ks.backgroundImage !== "none" && !k.classList.contains("neu-hintergrund")) unklar = true;
      const f = lesen(ks.backgroundColor);
      if (f && f.a > 0) bg = ueber(f, bg);
    }
    if (unklar) continue;
    const vorne = ueber(farbe, bg);
    const k = kontrast(vorne, bg);
    const groesse = parseFloat(stil.fontSize);
    const fett = Number(stil.fontWeight) >= 700;
    const soll = groesse >= 24 || (fett && groesse >= 18.66) ? 3 : 4.5;
    if (k + 1e-6 < soll) {
      const b = beschreibung(el);
      const schluessel = `${b}|${text(vorne)}|${text(bg)}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      funde.push({ beschreibung: b, text: inhalt.slice(0, 40), farbe: text(vorne), grund: text(bg), kontrast: Math.round(k * 100) / 100 });
    }
  }
  return funde;
}

export const pruefSkript = {
  horizontalScroll: pruefSkriptHorizontalScroll,
  lgTheme: pruefSkriptLgTheme,
  helleFlaechen: pruefSkriptHelleFlaechen,
  kontrast: pruefSkriptKontrast,
};
