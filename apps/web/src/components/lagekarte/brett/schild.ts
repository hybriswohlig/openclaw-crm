/**
 * Lagekarte, Spielbrett: Platz für das Namensschild des gewählten Leads.
 * Das Schild steht über dem Auswahlring; liegt dort ein Cluster (seine Zahl
 * wäre verdeckt) oder eine andere Figur, weicht es nach rechts, links, unten
 * oder schräg (über bzw. unter dem Ring, zur Seite versetzt) aus. Rein (ohne
 * maplibre), getestet in schild.test.ts. Alle Maße in Bildschirm-Pixeln
 * relativ zum Lead; die Werte passen zu brett.css.
 */

export type SchildSeite =
  | "oben"
  | "rechts"
  | "links"
  | "unten"
  | "oben-rechts"
  | "oben-links"
  | "unten-rechts"
  | "unten-links";

/** Etwas, das das Schild nicht verdecken soll: Kreis um (x, y), Gewicht = Schaden beim Verdecken. */
export interface Hindernis {
  x: number;
  y: number;
  r: number;
  gewicht: number;
}

export interface Rechteck {
  links: number;
  oben: number;
  rechts: number;
  unten: number;
}

/** Abstand der Schildkante vom Lead bei oben/unten (brett.css: bottom bzw. top 24px). */
export const SCHILD_ABSTAND_PX = 24;
/** Abstand bei rechts/links: Auswahlring (17 px Radius) plus Luft. */
export const SCHILD_SEITE_ABSTAND_PX = 22;
/** Höhe des Schilds: 18 px Zeile plus 2 × 3 px Polster. */
export const SCHILD_HOEHE_PX = 24;
/** Schräg: das Schild beginnt bzw. endet so weit hinter der Ringmitte. */
export const SCHILD_VERSATZ_PX = 10;

/** Bevorzugte Reihenfolge (mittig vor schräg); bei Gleichstand gewinnt die frühere Seite. */
const REIHENFOLGE: SchildSeite[] = ["oben", "rechts", "links", "unten", "oben-rechts", "oben-links", "unten-rechts", "unten-links"];
/** Schaden, wenn das Schild über den Kartenrand ragt. */
const RAND_GEWICHT = 2;

export function schildRechteck(seite: SchildSeite, breite: number, hoehe: number = SCHILD_HOEHE_PX): Rechteck {
  const darueber = { oben: -SCHILD_ABSTAND_PX - hoehe, unten: -SCHILD_ABSTAND_PX };
  const darunter = { oben: SCHILD_ABSTAND_PX, unten: SCHILD_ABSTAND_PX + hoehe };
  const nachRechts = { links: -SCHILD_VERSATZ_PX, rechts: -SCHILD_VERSATZ_PX + breite };
  const nachLinks = { links: SCHILD_VERSATZ_PX - breite, rechts: SCHILD_VERSATZ_PX };
  switch (seite) {
    case "oben-rechts":
      return { ...nachRechts, ...darueber };
    case "oben-links":
      return { ...nachLinks, ...darueber };
    case "unten-rechts":
      return { ...nachRechts, ...darunter };
    case "unten-links":
      return { ...nachLinks, ...darunter };
    case "oben":
      return { links: -breite / 2, rechts: breite / 2, oben: -SCHILD_ABSTAND_PX - hoehe, unten: -SCHILD_ABSTAND_PX };
    case "unten":
      return { links: -breite / 2, rechts: breite / 2, oben: SCHILD_ABSTAND_PX, unten: SCHILD_ABSTAND_PX + hoehe };
    case "rechts":
      return { links: SCHILD_SEITE_ABSTAND_PX, rechts: SCHILD_SEITE_ABSTAND_PX + breite, oben: -hoehe / 2, unten: hoehe / 2 };
    case "links":
      return { links: -SCHILD_SEITE_ABSTAND_PX - breite, rechts: -SCHILD_SEITE_ABSTAND_PX, oben: -hoehe / 2, unten: hoehe / 2 };
  }
}

function trifft(h: Hindernis, r: Rechteck): boolean {
  const dx = Math.max(r.links - h.x, 0, h.x - r.rechts);
  const dy = Math.max(r.oben - h.y, 0, h.y - r.unten);
  return dx * dx + dy * dy < h.r * h.r;
}

function ragtHinaus(r: Rechteck, grenze: Rechteck): boolean {
  return r.links < grenze.links || r.rechts > grenze.rechts || r.oben < grenze.oben || r.unten > grenze.unten;
}

/**
 * Seite mit dem geringsten Schaden (Summe der Gewichte verdeckter Hindernisse,
 * plus Kartenrand). `grenze` ist der sichtbare Kartenbereich relativ zum Lead.
 */
export function waehleSchildSeite(
  hindernisse: readonly Hindernis[],
  breite: number,
  grenze?: Rechteck,
  hoehe: number = SCHILD_HOEHE_PX,
): SchildSeite {
  let beste: SchildSeite = "oben";
  let besterSchaden = Infinity;
  for (const seite of REIHENFOLGE) {
    const r = schildRechteck(seite, breite, hoehe);
    let schaden = grenze && ragtHinaus(r, grenze) ? RAND_GEWICHT : 0;
    for (const h of hindernisse) if (trifft(h, r)) schaden += h.gewicht;
    if (schaden < besterSchaden) {
      beste = seite;
      besterSchaden = schaden;
      if (schaden === 0) break;
    }
  }
  return beste;
}

/**
 * Plakette mit der Zahl eines Clusters, der genau unter dem Auswahlring liegt
 * (typisch: mehrere Leads im selben PLZ-Gebiet). Ring und Figur verdecken
 * seine Zahl, deshalb steht sie unten links am Ring (brett.css: __stapel).
 */
export const STAPEL_MITTE = { x: -18, y: 10 } as const;
export const STAPEL_RADIUS_PX = 11;
/** Cluster-Mitte näher als der Ringradius: seine Zahl wäre verdeckt. */
const UNTER_RING_PX = 17;

/** Cluster in Bildschirm-Pixeln relativ zum Lead; `r` inklusive Rand und Wartet-Punkt. */
export interface ClusterKandidat {
  x: number;
  y: number;
  r: number;
  anzahl: number;
}

/**
 * Platz rund um die Auswahl: Seite für das Schild und ggf. die Zahl des
 * Clusters unter dem Ring. Der verdeckte Cluster selbst blockiert keine
 * Seite (seine Zahl steht ja an der Plakette), die Plakette dafür schon.
 */
export function auswahlPlatz(
  cluster: readonly ClusterKandidat[],
  figuren: readonly Hindernis[],
  breite: number,
  grenze?: Rechteck,
): { seite: SchildSeite; stapel: number | null } {
  let unter: ClusterKandidat | null = null;
  let abstand: number = UNTER_RING_PX;
  for (const c of cluster) {
    const d = Math.hypot(c.x, c.y);
    if (d < abstand) {
      unter = c;
      abstand = d;
    }
  }
  const hindernisse: Hindernis[] = [...figuren];
  for (const c of cluster) if (c !== unter) hindernisse.push({ x: c.x, y: c.y, r: c.r, gewicht: 3 });
  if (unter) hindernisse.push({ x: STAPEL_MITTE.x, y: STAPEL_MITTE.y, r: STAPEL_RADIUS_PX + 1, gewicht: 3 });
  return { seite: waehleSchildSeite(hindernisse, breite, grenze), stapel: unter?.anzahl ?? null };
}
