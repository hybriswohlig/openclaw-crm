import { leistungsWorte, type CustomerPortalContext, type LeistungsWorte } from "@openclaw-crm/customer-portal-core";

/** Wörter der Leistung dieses Auftrags in der Anrede der Firma. */
export function worte(ctx: Pick<CustomerPortalContext, "leistung" | "branding">): LeistungsWorte {
  return leistungsWorte(ctx.leistung, ctx.branding.firmaSlug);
}

export interface AdressZeile {
  key: "von" | "nach" | "ort";
  /** Aus welcher Adresse des Auftrags die Zeile stammt. */
  seite: "von" | "nach";
  label: string;
  adresse: string;
  etage: number | null;
  zugang: string | null;
}

/**
 * Umzug: Abholung und Ziel. Küche: nur der Montageort (Ziel vor Abholung),
 * Entrümpelung: nur der Einsatzort (Abholung vor Ziel).
 */
export function adressZeilen(ctx: Pick<CustomerPortalContext, "leistung" | "branding" | "scope">): AdressZeile[] {
  const w = worte(ctx);
  const s = ctx.scope;
  const vonText = s.fromAddress?.trim();
  const nachText = s.toAddress?.trim();
  const von = vonText ? { seite: "von" as const, adresse: vonText, etage: s.floorsFrom, zugang: s.accessFrom } : null;
  const nach = nachText ? { seite: "nach" as const, adresse: nachText, etage: s.floorsTo, zugang: s.accessTo } : null;
  if (w.adressen === "strecke") {
    return [
      ...(von ? [{ key: "von" as const, label: "Abholung", ...von }] : []),
      ...(nach ? [{ key: "nach" as const, label: "Ziel", ...nach }] : []),
    ];
  }
  const ort = ctx.leistung === "kitchen_installation" ? (nach ?? von) : (von ?? nach);
  return ort ? [{ key: "ort", label: w.einsatzortLabel, ...ort }] : [];
}

/**
 * Beschriftung der Kalkulationsgrundlagen. Mit nur einem Einsatzort heißen
 * Etage und Zugang schlicht so, die Angaben der anderen Adresse entfallen.
 */
export function annahmenLabels(ctx: Pick<CustomerPortalContext, "leistung" | "branding" | "scope">): Record<string, string | null> {
  const basis: Record<string, string | null> = {
    anfahrtMinuten: "Anfahrt gesamt (Minuten)",
    anfahrtQuelle: "Grundlage der Anfahrt",
    inventarPositionen: "Inventarpositionen",
    inventarVolumenCbm: "Inventarvolumen (m³)",
    hinweis: "Hinweis",
  };
  if (worte(ctx).adressen === "strecke") {
    return { ...basis, etageVon: "Etage Abholung", etageBis: "Etage Ziel", zugangVon: "Zugang Abholung", zugangBis: "Zugang Ziel" };
  }
  const seite = adressZeilen(ctx)[0]?.seite ?? (ctx.leistung === "kitchen_installation" ? "nach" : "von");
  return seite === "nach"
    ? { ...basis, etageVon: null, zugangVon: null, etageBis: "Etage", zugangBis: "Zugang" }
    : { ...basis, etageVon: "Etage", zugangVon: "Zugang", etageBis: null, zugangBis: null };
}
