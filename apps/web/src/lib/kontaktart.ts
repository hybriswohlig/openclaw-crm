/**
 * Kontaktart: lead versus everything that is not a customer request.
 * Pure module, safe for client components. Stored slugs are stable;
 * the person select shows the German label.
 */

export const KONTAKTART_SLUG = "kontaktart";

export const KONTAKTART_VALUES = [
  "lead_kunde",
  "bewerber",
  "team_helfer",
  "partner_vermittler",
  "privat",
  "spam_werbung",
] as const;

export type Kontaktart = (typeof KONTAKTART_VALUES)[number];

export const DEFAULT_KONTAKTART: Kontaktart = "lead_kunde";

export const KONTAKTART_LABELS: Record<Kontaktart, string> = {
  lead_kunde: "Lead/Kunde",
  bewerber: "Bewerber",
  team_helfer: "Team/Helfer",
  partner_vermittler: "Partner/Vermittler",
  privat: "Privat",
  spam_werbung: "Spam/Werbung",
};

export const KEIN_LEAD_LANE = "kein_lead" as const;
export const KEIN_LEAD_STAGE_TITLE = "Kein Lead";
export const KEIN_LEAD_STAGE_CATEGORY = "kein_lead";

const LABEL_TO_SLUG = new Map<string, Kontaktart>(
  KONTAKTART_VALUES.map((slug) => [fold(KONTAKTART_LABELS[slug]), slug])
);

function fold(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

export function isKontaktart(value: string | null | undefined): value is Kontaktart {
  return !!value && (KONTAKTART_VALUES as readonly string[]).includes(value);
}

/** Slug, German label, or empty. Unknown strings return null. */
export function normalizeKontaktart(value: string | null | undefined): Kontaktart | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isKontaktart(trimmed)) return trimmed;
  return LABEL_TO_SLUG.get(fold(trimmed)) ?? null;
}

/**
 * Missing and the default both count as a customer lead.
 * Only an explicit other Kontaktart leaves the lead KPIs.
 */
export function isLeadKunde(value: string | null | undefined): boolean {
  const slug = normalizeKontaktart(value);
  return slug == null || slug === DEFAULT_KONTAKTART;
}

export function isKeinLeadStage(input: {
  stageCategory?: string | null;
  stageTitle?: string | null;
}): boolean {
  if (input.stageCategory === KEIN_LEAD_STAGE_CATEGORY) return true;
  return fold(input.stageTitle ?? "") === fold(KEIN_LEAD_STAGE_TITLE);
}

/**
 * A deal is outside the lead KPIs when any linked signal says so:
 * a non-lead conversation, a non-lead person, or the Kein-Lead stage.
 */
export function dealIsNonLead(input: {
  conversationKontaktarten?: (string | null | undefined)[];
  personKontaktarten?: (string | null | undefined)[];
  stageCategory?: string | null;
  stageTitle?: string | null;
}): boolean {
  if (isKeinLeadStage(input)) return true;
  const signals = [...(input.conversationKontaktarten ?? []), ...(input.personKontaktarten ?? [])];
  return signals.some((value) => !isLeadKunde(value) && normalizeKontaktart(value) != null);
}

const PROTECTED_STAGE_CATEGORIES = new Set(["booked", "done_unpaid", "paid"]);

export type KontaktartStageMove = "kein_lead" | "restore_open" | "keep";

/** Booked, done, and paid deals stay put. Open and lost deals become Kein Lead. */
export function stageMoveForKontaktart(input: {
  kontaktart: string | null | undefined;
  stageCategory?: string | null;
  stageTitle?: string | null;
}): KontaktartStageMove {
  const keinLeadStage = isKeinLeadStage(input);
  const protectedStage =
    PROTECTED_STAGE_CATEGORIES.has(input.stageCategory ?? "") ||
    /^(bezahlt|paid|durchgefuehrt|durchgeführt|geplant|planned|booked|done)$/i.test(
      (input.stageTitle ?? "").trim()
    );
  if (!isLeadKunde(input.kontaktart)) {
    if (protectedStage || keinLeadStage) return "keep";
    return "kein_lead";
  }
  if (keinLeadStage) return "restore_open";
  return "keep";
}

export function laneForKontaktart(
  kontaktart: string | null | undefined,
  currentLane: string | null | undefined
): "lead" | "info" | "spam" | "review" | "kein_lead" {
  if (!isLeadKunde(kontaktart)) return KEIN_LEAD_LANE;
  if (currentLane === KEIN_LEAD_LANE || !currentLane) return "lead";
  if (currentLane === "info" || currentLane === "spam" || currentLane === "review" || currentLane === "lead") {
    return currentLane;
  }
  return "lead";
}

/**
 * Lane einer neuen Konversation, wenn die Person schon eine Kontaktart hat.
 * Nur was die Triage als Anfrage („lead“) einstuft, wird bei Bewerbern,
 * Team, Partnern usw. zu kein_lead; info, spam und review bleiben.
 */
export function eingangsLane<L extends string>(
  kontaktart: string | null | undefined,
  triageLane: L
): L | typeof KEIN_LEAD_LANE {
  return triageLane === "lead" && !isLeadKunde(kontaktart) ? KEIN_LEAD_LANE : triageLane;
}

const BEWERBER_PATTERN =
  /bewerbung|bewerbe mich|initiativbewerbung|lebenslauf|gehaltsvorstellung|suche eine stelle|als helfer arbeiten|job als helfer/i;

/** Verbatim slice of a job application, or null. Used as enrichment evidence. */
export function bewerberQuote(text: string): string | null {
  const match = BEWERBER_PATTERN.exec(text);
  if (!match || match.index == null) return null;
  const quote = match[0].replace(/\s+/g, " ").trim();
  return quote.length >= 4 ? quote : null;
}

export interface NonLeadMonthBucket {
  month: string;
  kontaktart: Kontaktart;
  label: string;
  count: number;
}

/** Last six months, oldest first. Only non-lead Kontaktarten. */
export function bucketNonLeadsByMonth(
  rows: { kontaktart: string | null | undefined; at: Date }[],
  now = new Date()
): NonLeadMonthBucket[] {
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const slug = normalizeKontaktart(row.kontaktart);
    if (!slug || slug === DEFAULT_KONTAKTART) continue;
    const month = `${row.at.getUTCFullYear()}-${String(row.at.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!months.includes(month)) continue;
    const key = `${month}|${slug}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: NonLeadMonthBucket[] = [];
  for (const month of months) {
    for (const slug of KONTAKTART_VALUES) {
      if (slug === DEFAULT_KONTAKTART) continue;
      const count = counts.get(`${month}|${slug}`) ?? 0;
      if (count === 0) continue;
      out.push({ month, kontaktart: slug, label: KONTAKTART_LABELS[slug], count });
    }
  }
  return out;
}

export interface LeadKpiInput {
  id: string;
  kontaktart?: string | null;
  stageCategory?: string | null;
  stageTitle?: string | null;
  createdAt?: Date;
  value?: number;
}

export interface LeadKpiSummary {
  leadCount: number;
  won: number;
  lost: number;
  winRatePct: number | null;
  pipelineValue: number;
}

const WON = new Set(["paid", "done_unpaid"]);

/**
 * Lead KPIs ignore non-leads and the Kein-Lead stage.
 * Won = paid or done. Lost = Verloren. Kein Lead is neither.
 */
export function summarizeLeadKpis(deals: LeadKpiInput[]): LeadKpiSummary {
  let leadCount = 0;
  let won = 0;
  let lost = 0;
  let pipelineValue = 0;
  for (const deal of deals) {
    if (
      dealIsNonLead({
        conversationKontaktarten: [deal.kontaktart],
        stageCategory: deal.stageCategory,
        stageTitle: deal.stageTitle,
      })
    ) {
      continue;
    }
    leadCount += 1;
    pipelineValue += deal.value ?? 0;
    if (WON.has(deal.stageCategory ?? "") || /^(bezahlt|paid|durchgeführt|durchgefuehrt|done)$/i.test(deal.stageTitle ?? "")) {
      won += 1;
    } else if (deal.stageCategory === "lost" || /^(verloren|lost)$/i.test((deal.stageTitle ?? "").trim())) {
      lost += 1;
    }
  }
  const decisions = won + lost;
  return {
    leadCount,
    won,
    lost,
    winRatePct: decisions > 0 ? Math.round((won / decisions) * 100) : null,
    pipelineValue,
  };
}
