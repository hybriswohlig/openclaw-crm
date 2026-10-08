/**
 * Preisquelle der Auftragsbestätigung aus dem bei der Annahme eingefrorenen
 * Angebot (kva_confirmations.quotation_snapshot). Gleiche Form wie die
 * Angebotszeile, damit die AB dieselbe Preisaufbereitung nutzt wie der KV.
 */

export interface PreisQuelle {
  isVariable: boolean;
  fixedPrice: string | null;
  lineItems: Array<{ type: string; description: string | null; quantity: number; unitRate: string }>;
}

interface SnapshotPosten {
  type?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitRate?: unknown;
}

/**
 * null, wenn der Snapshot keinen brauchbaren Preis trägt (Altbestand); dann
 * gilt das aktuelle Angebot. Die Anzahlung gehört nicht dazu, sie legt das
 * Team im AB-Dialog fest. Beim Festpreis gilt der angenommene Betrag, auch
 * wenn er aus einer Paketoption stammt. Passen die Posten nicht zu ihm,
 * bekommt die AB nur den Betrag, sonst ergäben die Posten eine andere Summe.
 */
export function preisQuelleAusAnnahme(snapshot: unknown): PreisQuelle | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.totalCents !== "number" || !Array.isArray(s.lineItems)) return null;

  const zahl = (v: unknown) => (typeof v === "number" || typeof v === "string" ? Number(v) : NaN);
  const posten = (s.lineItems as SnapshotPosten[])
    .filter((l) => Number.isFinite(zahl(l.quantity)) && Number.isFinite(zahl(l.unitRate)))
    .map((l) => ({
      type: typeof l.type === "string" ? l.type : "other",
      description: typeof l.description === "string" ? l.description : null,
      quantity: zahl(l.quantity),
      unitRate: String(zahl(l.unitRate)),
    }));

  if (s.isVariable === true) {
    if (posten.length === 0) return null;
    return {
      isVariable: true,
      fixedPrice: typeof s.fixedPriceCents === "number" ? (s.fixedPriceCents / 100).toFixed(2) : null,
      lineItems: posten,
    };
  }

  const summeCents = posten
    .filter((l) => Number(l.unitRate) > 0)
    .reduce((sum, l) => sum + Math.round(Number(l.unitRate) * l.quantity * 100), 0);
  return {
    isVariable: false,
    fixedPrice: (s.totalCents / 100).toFixed(2),
    lineItems: summeCents === s.totalCents ? posten : [],
  };
}
