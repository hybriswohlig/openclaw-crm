import { KUNDEN_ANSICHTEN, type KundenAnsicht } from "@/lib/bewertungen-kunden";

export function istKundenAnsicht(v: unknown): v is KundenAnsicht {
  return typeof v === "string" && (KUNDEN_ANSICHTEN as readonly string[]).includes(v);
}
