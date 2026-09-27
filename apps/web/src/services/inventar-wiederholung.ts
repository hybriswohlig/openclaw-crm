/**
 * Regeln für die Wiederholung fehlgeschlagener Inventar-Erstbefüllungen.
 * Reine Funktionen ohne Datenbank (der Lauf steht in inventar-wiederholung-lauf.ts).
 *
 * Jeder Versuch wird VOR dem KI-Aufruf als Ereignis ai.inventory_extract_attempt
 * mit Status "laeuft" gespeichert und danach auf ok/leer/fehler/nicht_moeglich
 * gesetzt. Bleibt er auf "laeuft" (Funktion abgebrochen), zählt er als Fehlversuch.
 *
 * Regeln: nur Versuche der letzten 24 Stunden zählen; höchstens 3 Fehlversuche;
 * frühestens 15 Minuten nach dem letzten Versuch; fällig nur, wenn der letzte
 * Versuch fehlschlug und danach kein ai.inventory_extracted kam. Nach einem
 * Fehlschlag wiederholt nur der Cron, nicht der Worker.
 */
export const INVENTAR_WIEDERHOLUNG = {
  fensterMs: 24 * 60 * 60_000,
  maxVersuche: 3,
  wartezeitMs: 15 * 60_000,
} as const;

export type VersuchsStatus = "laeuft" | "ok" | "leer" | "fehler" | "nicht_moeglich";

export interface InventarVersuch {
  workspaceId: string;
  dealRecordId: string;
  createdAt: Date;
  status: VersuchsStatus;
}

export interface InventarEreignis {
  workspaceId: string;
  dealRecordId: string;
  createdAt: Date;
}

const fehlgeschlagen = (s: VersuchsStatus) => s === "fehler" || s === "laeuft";

/** Fällige Deals, der am längsten wartende zuerst. */
export function waehleWiederholung(
  versuche: readonly InventarVersuch[],
  jetzt: Date,
  erfolge: readonly InventarEreignis[] = []
): Array<{ workspaceId: string; dealRecordId: string; versuche: number }> {
  const { fensterMs, maxVersuche, wartezeitMs } = INVENTAR_WIEDERHOLUNG;
  const imFenster = (d: Date) => jetzt.getTime() - d.getTime() <= fensterMs;

  const proDeal = new Map<string, { workspaceId: string; dealRecordId: string; fehl: number; letzter: InventarVersuch }>();
  for (const v of versuche) {
    if (!imFenster(v.createdAt)) continue;
    const key = `${v.workspaceId}:${v.dealRecordId}`;
    const d = proDeal.get(key) ?? { workspaceId: v.workspaceId, dealRecordId: v.dealRecordId, fehl: 0, letzter: v };
    if (fehlgeschlagen(v.status)) d.fehl += 1;
    if (v.createdAt.getTime() >= d.letzter.createdAt.getTime()) d.letzter = v;
    proDeal.set(key, d);
  }
  const letzterErfolg = new Map<string, number>();
  for (const e of erfolge) {
    const key = `${e.workspaceId}:${e.dealRecordId}`;
    letzterErfolg.set(key, Math.max(letzterErfolg.get(key) ?? 0, e.createdAt.getTime()));
  }

  return [...proDeal.entries()]
    .filter(([key, d]) => {
      const zeit = d.letzter.createdAt.getTime();
      return (
        fehlgeschlagen(d.letzter.status) &&
        d.fehl < maxVersuche &&
        jetzt.getTime() - zeit >= wartezeitMs &&
        (letzterErfolg.get(key) ?? 0) < zeit
      );
    })
    .map(([, d]) => d)
    .sort((a, b) => a.letzter.createdAt.getTime() - b.letzter.createdAt.getTime())
    .map((d) => ({ workspaceId: d.workspaceId, dealRecordId: d.dealRecordId, versuche: d.fehl }));
}

/** Darf der Worker eine Erstbefüllung starten? Versuche eines einzigen Deals. */
export function workerDarfExtrahieren(versucheDesDeals: readonly InventarVersuch[], jetzt: Date): boolean {
  const imFenster = versucheDesDeals.filter((v) => jetzt.getTime() - v.createdAt.getTime() <= INVENTAR_WIEDERHOLUNG.fensterMs);
  if (imFenster.length === 0) return true;
  const letzter = imFenster.reduce((a, b) => (b.createdAt.getTime() >= a.createdAt.getTime() ? b : a));
  return !fehlgeschlagen(letzter.status);
}
