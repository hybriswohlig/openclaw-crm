/**
 * Customer-facing address for portal copy and the messages that flow sends.
 * Kottke speaks du. Every other company, including Ceylan, stays sie.
 * Pronouns in the du texts are lowercase (du, dir, dein), except at the
 * start of a sentence.
 */
export type KundenAnrede = "du" | "sie";

export function kundenAnrede(firma: string | null | undefined): KundenAnrede {
  return firma && /kottke/i.test(firma) ? "du" : "sie";
}

/** One switch for a Sie sentence and its Du sentence. */
export function kundenText(
  firma: string | null | undefined,
  sie: string,
  du: string,
): string {
  return kundenAnrede(firma) === "du" ? du : sie;
}
