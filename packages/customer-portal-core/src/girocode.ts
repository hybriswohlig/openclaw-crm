/**
 * EPC QR (Girocode) payload builder.
 *
 * Format spec: EPC069-12 v002 (last published 2020-11) — supported by every
 * German banking app: Sparkasse, Volksbank, ING, Comdirect, N26, DKB, …
 *
 * Layout (newline-separated):
 *   BCD
 *   002             ← version
 *   1               ← character set (1 = UTF-8)
 *   SCT             ← SEPA Credit Transfer
 *   <BIC>           ← optional in v002
 *   <Name>          ← max 70 chars
 *   <IBAN>          ← required, no spaces
 *   EUR<Amount>     ← e.g. EUR123.45, two decimals
 *   <Purpose code>  ← empty
 *   <Reference>     ← structured; we use ""
 *   <Remittance>    ← free text, max 140 chars
 */

export interface GirocodeInput {
  beneficiaryName: string;
  iban: string;
  bic?: string | null;
  amountCents: number;
  remittance: string;
}

export function buildGirocodePayload(input: GirocodeInput): string {
  const name = sanitize(input.beneficiaryName).slice(0, 70);
  const iban = stripWhitespace(input.iban).toUpperCase();
  const bic = stripWhitespace(input.bic ?? "").toUpperCase();
  const amount = formatEurAmount(input.amountCents);
  const remittance = sanitize(input.remittance).slice(0, 140);

  return [
    "BCD",
    "002",
    "1",
    "SCT",
    bic,
    name,
    iban,
    `EUR${amount}`,
    "",
    "",
    remittance,
  ].join("\n");
}

function formatEurAmount(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error("amountCents must be a non-negative finite number");
  }
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${whole}.${rest.toString().padStart(2, "0")}`;
}

function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Drop control characters and DEL. Newlines would break the payload itself.
 */
function sanitize(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      if (!out.endsWith(" ")) out += " ";
    } else {
      out += ch;
    }
  }
  return out.trim();
}
