/**
 * Typed registry of every AI task in the CRM.
 *
 * Adding a new task = add a slug here + insert an `ai_task_configs` row for
 * each workspace (done lazily on first run via `runAITask`).
 */

export const AI_TASK_SLUGS = {
  DEAL_EXTRACT_INSIGHTS: "deal.extract-insights",
  // AI-Umzugsanalyse: structured per-item inventory from the chat transcript
  // (deal_inventory_items rows), Phase 2 of the Quote-Cockpit feature.
  DEAL_EXTRACT_INVENTORY: "deal.extract-inventory",
  // AI-Umzugsanalyse Phase 2b: vision pass over customer photos — recognizes
  // items, estimates rough dimensions, feeds the chat↔photo matching.
  DEAL_INVENTORY_FROM_PHOTOS: "deal.inventory-from-photos",
  // Status-Link wizard: conversational package tuning (prices + included/
  // excluded lists) against inventory + assumptions. Draft-only — the operator
  // applies the proposal, the AI never writes.
  DEAL_PACKAGE_ADVISOR: "deal.package-advisor",
  // The inbox "Antwort vorschlagen" button (suggest-reply endpoint).
  DEAL_DRAFT_REPLY: "deal.draft-reply",
  // Operator-triggered photo analysis: customer-facing scope summary for the
  // offer, generated from curated customer photos (scope-from-photos endpoint).
  DEAL_SCOPE_FROM_PHOTOS: "deal.scope-from-photos",
  // Sales agent (the on/off inbox assistant). reply = decide-and-send a turn,
  // followup = re-engage a stale lead, first-contact = proactive ImmoScout opener.
  // On/off for these three lives in the KI-Verkaufsassistent cards, NOT in the
  // AI-task enable toggle (see ENGINE_OWNED_TASKS).
  LEAD_ASSISTANT_REPLY: "lead.assistant.reply",
  LEAD_FOLLOWUP: "lead.followup",
  LEAD_FIRST_CONTACT: "lead.first-contact",
} as const;

/**
 * Sales-agent tasks whose on/off is owned by the dedicated KI-Verkaufsassistent
 * feature cards (master switch / follow-up / first-contact toggles), NOT by the
 * generic per-task enable flag. runAITask ignores a disabled flag for these so
 * the AI-task toggle can never silently break a feature that the card says is
 * on. The AI Tasks UI hides the enable toggle for them and only exposes the
 * model/provider config.
 */
export const ENGINE_OWNED_TASKS: ReadonlySet<string> = new Set([
  AI_TASK_SLUGS.LEAD_ASSISTANT_REPLY,
  AI_TASK_SLUGS.LEAD_FOLLOWUP,
  AI_TASK_SLUGS.LEAD_FIRST_CONTACT,
]);

export type AITaskSlug = (typeof AI_TASK_SLUGS)[keyof typeof AI_TASK_SLUGS];

export interface AITaskDefinition {
  slug: AITaskSlug;
  label: string;
  description: string;
  // Product AI runs only on the VPS (Grok Build CLI + Claude Code CLI).
  // "openrouter" remains in the type for legacy workspace rows but is not used
  // when CRM_TOOLS_* env is configured (see runAITask).
  defaultProvider: "openrouter" | "crm-tools";
  defaultModel: string;
  defaultFallbackModel: string | null;
  defaultTemperature: number | null;
  defaultMaxTokens: number | null;
  defaultDailySpendCapUsd: number | null;
  // When true and the task returns a plain string (no Zod schema), runAITask
  // pipes the output through the `humanizer-de` skill on crm-tools before
  // returning. Used for customer-facing drafts so they don't read as AI-typical.
  humanizeOutput?: boolean;
}

export const AI_TASK_REGISTRY: Record<AITaskSlug, AITaskDefinition> = {
  [AI_TASK_SLUGS.DEAL_EXTRACT_INSIGHTS]: {
    slug: AI_TASK_SLUGS.DEAL_EXTRACT_INSIGHTS,
    label: "Deal insights extraction",
    description:
      "Runs over the cross-channel transcript of a deal and extracts structured fields plus open questions.",
    defaultProvider: "crm-tools",
    defaultModel: "grok-4.5",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.2,
    defaultMaxTokens: 4096,
    defaultDailySpendCapUsd: 5,
  },
  [AI_TASK_SLUGS.DEAL_EXTRACT_INVENTORY]: {
    slug: AI_TASK_SLUGS.DEAL_EXTRACT_INVENTORY,
    label: "Inventar-Extraktion (Umzugsanalyse)",
    description:
      "Extrahiert eine strukturierte Item-Liste (Möbel, Kartons, Geräte) mit Größe/Gewicht/Zerlege-Flags aus dem Gesprächsverlauf eines Deals.",
    defaultProvider: "crm-tools",
    defaultModel: "grok-4.5",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.2,
    defaultMaxTokens: 4096,
    defaultDailySpendCapUsd: 5,
  },
  [AI_TASK_SLUGS.DEAL_INVENTORY_FROM_PHOTOS]: {
    slug: AI_TASK_SLUGS.DEAL_INVENTORY_FROM_PHOTOS,
    label: "Inventar-Foto-Analyse (Umzugsanalyse)",
    description:
      "Erkennt Umzugsgut auf Kundenfotos (inkl. grober Maßschätzung) für das Matching gegen die Chat-Inventarliste.",
    defaultProvider: "crm-tools",
    // Primary vision path on crm-tools; fallback only if primary fails.
    defaultModel: "grok-build",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.2,
    defaultMaxTokens: 4096,
    defaultDailySpendCapUsd: 5,
  },
  [AI_TASK_SLUGS.DEAL_PACKAGE_ADVISOR]: {
    slug: AI_TASK_SLUGS.DEAL_PACKAGE_ADVISOR,
    label: "Paket-Berater (Status-Link)",
    description:
      "Chat im Status-Link-Wizard: passt Paketpreise und Enthalten/Nicht-enthalten-Listen auf Zuruf an (Vorschlag mit Übernehmen-Button, schreibt nie selbst).",
    defaultProvider: "crm-tools",
    defaultModel: "grok-build",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.3,
    defaultMaxTokens: 4096,
    defaultDailySpendCapUsd: 3,
  },
  [AI_TASK_SLUGS.DEAL_DRAFT_REPLY]: {
    slug: AI_TASK_SLUGS.DEAL_DRAFT_REPLY,
    label: "Antwort-Vorschlag (Inbox)",
    description:
      "Schreibt auf Knopfdruck einen Antwortentwurf in das Kompositionsfeld der Inbox, im Ton des Kunden. Sendet nie selbst.",
    defaultProvider: "crm-tools",
    defaultModel: "grok-4.5",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.4,
    defaultMaxTokens: 1500,
    defaultDailySpendCapUsd: 2,
    humanizeOutput: true,
  },
  [AI_TASK_SLUGS.DEAL_SCOPE_FROM_PHOTOS]: {
    slug: AI_TASK_SLUGS.DEAL_SCOPE_FROM_PHOTOS,
    label: "Foto-Analyse Angebot",
    description:
      "Analysiert vom Kunden geschickte Fotos und erzeugt die kundengerechte Auftrags-Zusammenfassung plus erkanntes Inventar und interne Hinweise.",
    defaultProvider: "crm-tools",
    defaultModel: "claude-code",
    // Photo tasks keep multi-turn tools on the server path.
    defaultFallbackModel: "grok-build",
    defaultTemperature: 0.3,
    defaultMaxTokens: 4096,
    defaultDailySpendCapUsd: 3,
  },
  [AI_TASK_SLUGS.LEAD_ASSISTANT_REPLY]: {
    slug: AI_TASK_SLUGS.LEAD_ASSISTANT_REPLY,
    label: "Sales agent reply turn",
    description:
      "The on/off sales assistant. Decides the next conversation turn (ask for info, hand off to a human, or no-op) and drafts the German customer message. Never names a price.",
    defaultProvider: "crm-tools",
    defaultModel: "grok-4.5",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.4,
    defaultMaxTokens: 1200,
    defaultDailySpendCapUsd: 5,
  },
  [AI_TASK_SLUGS.LEAD_FOLLOWUP]: {
    slug: AI_TASK_SLUGS.LEAD_FOLLOWUP,
    label: "Sales agent follow-up",
    description:
      "Re-engages a stale lead whose move date is still in the future: one gentle nudge after a few days of silence. Never names a price.",
    defaultProvider: "crm-tools",
    defaultModel: "grok-4.5",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.4,
    defaultMaxTokens: 800,
    defaultDailySpendCapUsd: 2,
  },
  [AI_TASK_SLUGS.LEAD_FIRST_CONTACT]: {
    slug: AI_TASK_SLUGS.LEAD_FIRST_CONTACT,
    label: "Sales agent first contact (ImmoScout)",
    description:
      "Composes the proactive WhatsApp opener for a fresh ImmoScout lead: references the inquiry, asks ONE easy question, proposes a call. Never names a price.",
    defaultProvider: "crm-tools",
    defaultModel: "grok-4.5",
    defaultFallbackModel: "claude-code",
    defaultTemperature: 0.4,
    defaultMaxTokens: 800,
    defaultDailySpendCapUsd: 3,
  },
};

export function listTaskDefinitions(): AITaskDefinition[] {
  return Object.values(AI_TASK_REGISTRY);
}

export function getTaskDefinition(slug: string): AITaskDefinition | null {
  return (AI_TASK_REGISTRY as Record<string, AITaskDefinition>)[slug] ?? null;
}
