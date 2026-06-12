/**
 * Typed registry of every AI task in the CRM.
 *
 * Adding a new task = add a slug here + insert an `ai_task_configs` row for
 * each workspace (done lazily on first run via `runAITask`).
 */

export const AI_TASK_SLUGS = {
  DEAL_EXTRACT_INSIGHTS: "deal.extract-insights",
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
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: "openai/gpt-4o",
    defaultTemperature: 0.2,
    defaultMaxTokens: 4096,
    defaultDailySpendCapUsd: 5,
  },
  [AI_TASK_SLUGS.DEAL_DRAFT_REPLY]: {
    slug: AI_TASK_SLUGS.DEAL_DRAFT_REPLY,
    label: "Antwort-Vorschlag (Inbox)",
    description:
      "Schreibt auf Knopfdruck einen Antwortentwurf in das Kompositionsfeld der Inbox, im Ton des Kunden. Sendet nie selbst.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
    defaultTemperature: 0.4,
    defaultMaxTokens: 1500,
    defaultDailySpendCapUsd: 2,
    humanizeOutput: true,
  },
  [AI_TASK_SLUGS.DEAL_SCOPE_FROM_PHOTOS]: {
    slug: AI_TASK_SLUGS.DEAL_SCOPE_FROM_PHOTOS,
    label: "Foto-Analyse Angebot",
    description:
      "Analysiert vom Kunden geschickte Fotos und erzeugt die kundengerechte Auftrags-Zusammenfassung plus erkanntes Inventar und interne Hinweise. Bilder verarbeitet nur der crm-tools-Pfad, OpenRouter verwirft Anhänge.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    // No OpenRouter fallback: that path is text-only and would silently drop
    // the photos this task exists for.
    defaultFallbackModel: null,
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
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: "openai/gpt-4o",
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
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
    defaultTemperature: 0.4,
    defaultMaxTokens: 800,
    defaultDailySpendCapUsd: 2,
  },
  [AI_TASK_SLUGS.LEAD_FIRST_CONTACT]: {
    slug: AI_TASK_SLUGS.LEAD_FIRST_CONTACT,
    label: "Sales agent first contact (ImmoScout)",
    description:
      "Composes the proactive WhatsApp opener for a fresh ImmoScout lead: references the inquiry, asks ONE easy question, proposes a call. Never names a price. Runs on crm-tools (the VPS), like everything else here.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
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
