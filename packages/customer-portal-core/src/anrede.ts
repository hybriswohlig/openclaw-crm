/**
 * Customer-facing address for portal copy and the messages that flow sends.
 * Kottke speaks du. Every other company, including Ceylan, stays sie.
 * Pronouns in the du texts are lowercase (du, dir, dein), except at the
 * start of a sentence.
 */
export type KundenAnrede = "du" | "sie";

/**
 * Firma als Text, oder ein Objekt mit optionaler Deal-Anrede.
 * Eine gesetzte Anrede (`sie` oder `du`) gewinnt. Sonst: Kottke du, alle anderen Sie.
 */
export type AnredeQuelle =
  | string
  | null
  | undefined
  | {
      firma?: string | null;
      firmaSlug?: string | null;
      displayName?: string | null;
      anrede?: "sie" | "du" | null;
    };

export function kundenAnrede(firma: AnredeQuelle): KundenAnrede {
  if (firma && typeof firma === "object") {
    if (firma.anrede === "sie" || firma.anrede === "du") return firma.anrede;
    return kundenAnrede(firma.firmaSlug ?? firma.firma ?? firma.displayName);
  }
  return typeof firma === "string" && /kottke/i.test(firma) ? "du" : "sie";
}

/** One switch for a Sie sentence and its Du sentence. */
export function kundenText(firma: AnredeQuelle, sie: string, du: string): string {
  return kundenAnrede(firma) === "du" ? du : sie;
}

/**
 * Begrüßung. Du: „Hallo {Vorname},“. Ausdrückliches Sie am Deal: „Guten Tag,“.
 * Ohne gesetzte Anrede bleibt die bisherige Zeile „Hallo,“ auch beim Sie
 * (Ceylan), der Text darunter siezt.
 */
export function kundenGruss(firma: AnredeQuelle, vorname: string | null | undefined): string {
  const form = kundenAnrede(firma);
  const ausdruecklich = !!(firma && typeof firma === "object" && (firma.anrede === "sie" || firma.anrede === "du"));
  if (form === "du") {
    const name = vorname?.trim();
    return name ? `Hallo ${name},` : "Hallo,";
  }
  if (ausdruecklich) return "Guten Tag,";
  const name = vorname?.trim();
  return name ? `Hallo ${name},` : "Hallo,";
}
