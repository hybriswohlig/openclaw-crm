/**
 * Typed registry of every AI task in the CRM.
 *
 * Adding a new task = add a slug here + insert an `ai_task_configs` row for
 * each workspace (done lazily on first run via `runAITask`).
 */

export const AI_TASK_SLUGS = {
  DEAL_EXTRACT_INSIGHTS: "deal.extract-insights",
  CHAT_ASSISTANT: "chat.assistant",
  // Forward-declared for later phases — registry entries exist so the admin
  // UI lists them, even though no code path calls them yet.
  DEAL_DRAFT_REPLY: "deal.draft-reply",
  CALL_SUMMARIZE: "call.summarize",
  // Sales agent (the on/off inbox assistant). reply = decide-and-send a turn,
  // followup = re-engage a stale lead (Phase 3).
  LEAD_ASSISTANT_REPLY: "lead.assistant.reply",
  LEAD_FOLLOWUP: "lead.followup",
} as const;

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
  [AI_TASK_SLUGS.CHAT_ASSISTANT]: {
    slug: AI_TASK_SLUGS.CHAT_ASSISTANT,
    label: "CRM chat assistant",
    description:
      "The /chat assistant with tool calls over the CRM.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
    defaultTemperature: null,
    defaultMaxTokens: null,
    defaultDailySpendCapUsd: 10,
  },
  [AI_TASK_SLUGS.DEAL_DRAFT_REPLY]: {
    slug: AI_TASK_SLUGS.DEAL_DRAFT_REPLY,
    label: "Deal auto-reply draft (P4)",
    description:
      "Drafts a reply into the compose box, matching the customer's tone. Never sends.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
    defaultTemperature: 0.4,
    defaultMaxTokens: 1500,
    defaultDailySpendCapUsd: 2,
    humanizeOutput: true,
  },
  [AI_TASK_SLUGS.CALL_SUMMARIZE]: {
    slug: AI_TASK_SLUGS.CALL_SUMMARIZE,
    label: "Call summarization (P4)",
    description:
      "Summarizes a CloudTalk call transcript into key points and action items.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
    defaultTemperature: 0.2,
    defaultMaxTokens: 2000,
    defaultDailySpendCapUsd: 2,
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
    label: "Sales agent follow-up (P3)",
    description:
      "Re-engages a stale lead whose move date is still in the future. Phase 3, not wired yet.",
    defaultProvider: "crm-tools",
    defaultModel: "anthropic/claude-sonnet-4",
    defaultFallbackModel: null,
    defaultTemperature: 0.4,
    defaultMaxTokens: 800,
    defaultDailySpendCapUsd: 2,
  },
};

export function listTaskDefinitions(): AITaskDefinition[] {
  return Object.values(AI_TASK_REGISTRY);
}

export function getTaskDefinition(slug: string): AITaskDefinition | null {
  return (AI_TASK_REGISTRY as Record<string, AITaskDefinition>)[slug] ?? null;
}
