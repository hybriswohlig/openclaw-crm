/** Display helpers with no Node imports, safe for the client bundle. */

export function callActivityTitle(input: {
  callerE164: string | null;
  callerRaw: string | null;
  durationSeconds: number | null;
  lineLabel: string | null;
}): string {
  const who = input.callerE164
    ? input.callerE164.startsWith("+49")
      ? `0${input.callerE164.slice(3)}`
      : input.callerE164
    : input.callerRaw?.trim() || "ohne Nummer";
  const bits = [`Anruf von ${who}`];
  if (input.lineLabel) bits.push(input.lineLabel);
  if (input.durationSeconds != null && input.durationSeconds > 0) {
    bits.push(`${Math.max(1, Math.round(input.durationSeconds / 60))} Min.`);
  }
  return bits.join(" · ");
}

/** Staff list. A matched call links to the person instead of repeating this word. */
export function matchStatusLabel(status: string): string {
  switch (status) {
    case "matched":
      return "Kunde";
    case "unmatched":
      return "Keine Kundenkarte";
    case "ambiguous":
      return "Mehrere Kunden";
    case "no_number":
      return "Ohne Nummer";
    default:
      return status;
  }
}
