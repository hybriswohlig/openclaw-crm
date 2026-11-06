/**
 * „Ich habe bezahlt“ aus dem Kundenlink (Entscheidung 6): die Meldung bleibt
 * ein Ereignis `customer.marked_paid`. Offen ist je Variante nur die neueste
 * Meldung, nach der kein Bestätigen oder Verwerfen derselben Variante liegt.
 * Ein Folgeereignis schließt damit auch alle älteren Meldungen der Variante.
 */
import { zahlungsartAus, type Zahlungsart } from "./zahlungsart";

export const MELDUNG_GEMELDET = "customer.marked_paid";
export const MELDUNG_BESTAETIGT = "payment.meldung_bestaetigt";
export const MELDUNG_VERWORFEN = "payment.meldung_verworfen";
export const MELDUNG_EREIGNISTYPEN = [MELDUNG_GEMELDET, MELDUNG_BESTAETIGT, MELDUNG_VERWORFEN] as const;

export type Meldungsvariante = "deposit" | "final";
const VARIANTEN: readonly Meldungsvariante[] = ["deposit", "final"];

export interface Zahlungsmeldung {
  eventId: string;
  gemeldetAm: string;
  betragCent: number;
  zahlungsart: Zahlungsart | null;
  variante: Meldungsvariante;
}

type Ereignis = { id: string; eventType: string; payload: unknown; createdAt: Date | string };

const istVariante = (v: unknown): v is Meldungsvariante => v === "deposit" || v === "final";
const zeitpunkt = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/** Meldung aus einem `customer.marked_paid`, sonst null (ohne gültigen Betrag oder Variante). */
function meldungAus(e: Ereignis): Zahlungsmeldung | null {
  if (e.eventType !== MELDUNG_GEMELDET) return null;
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const betrag = p.amountCents;
  if (typeof betrag !== "number" || !Number.isInteger(betrag) || betrag <= 0) return null;
  if (!istVariante(p.variant)) return null;
  const art = zahlungsartAus(p.method);
  return {
    eventId: e.id,
    gemeldetAm: new Date(zeitpunkt(e.createdAt)).toISOString(),
    betragCent: betrag,
    zahlungsart: art === "ungueltig" ? null : art,
    variante: p.variant,
  };
}

export function offeneMeldungen(ereignisse: Ereignis[]): Zahlungsmeldung[] {
  const folgen = ereignisse
    .filter((e) => e.eventType === MELDUNG_BESTAETIGT || e.eventType === MELDUNG_VERWORFEN)
    .map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return { zeit: zeitpunkt(e.createdAt), variante: p.variante, eventId: p.eventId };
    });

  const offen: Zahlungsmeldung[] = [];
  for (const variante of VARIANTEN) {
    let neueste: { meldung: Zahlungsmeldung; zeit: number } | null = null;
    for (const e of ereignisse) {
      const m = meldungAus(e);
      if (!m || m.variante !== variante) continue;
      const zeit = zeitpunkt(e.createdAt);
      if (!neueste || zeit > neueste.zeit) neueste = { meldung: m, zeit };
    }
    if (!neueste) continue;
    const { meldung, zeit } = neueste;
    // Eine Folge, die diese Meldung nennt, schließt sie auch bei gleichem Zeitstempel.
    const erledigt = folgen.some(
      (f) => f.eventId === meldung.eventId || (f.variante === variante && f.zeit > zeit),
    );
    if (!erledigt) offen.push(meldung);
  }
  return offen;
}
