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

export const pruefSkript = {
  horizontalScroll: pruefSkriptHorizontalScroll,
  lgTheme: pruefSkriptLgTheme,
  helleFlaechen: pruefSkriptHelleFlaechen,
};
