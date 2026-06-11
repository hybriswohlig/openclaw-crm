/**
 * Sales agent control plane (master switch + dry-run + channel allow-list).
 *
 * Stored in the per-workspace key/value store (`workspace_settings`, plain
 * values). Safe-by-default: an unset key reads as OFF, so deploying this code
 * never starts the agent. The owner turns it on explicitly in Settings.
 *
 * Two flags:
 *  - sales_agent_enabled: master on/off. Default OFF (null => false).
 *  - sales_agent_dry_run: when on, the worker decides and logs but never sends
 *    a message, drafts an offer, sets a stage, or pushes the owner. Default ON
 *    (null => true) so the first time the owner enables the agent it observes
 *    before it acts. Flip to "false" to go live.
 *
 * Owner decisions (2026-06-03): agent auto-sends info-gathering questions,
 * holds anything price/offer/booking for the owner, gathers then pushes
 * "ready to price". Channels at launch: WhatsApp + Email (+ Kleinanzeigen,
 * which rides on Email). SMS is off by default.
 */

import { getSetting, setSetting } from "@/services/workspace-settings";

const KEY_ENABLED = "sales_agent_enabled";
const KEY_DRY_RUN = "sales_agent_dry_run";
const KEY_CHANNELS = "sales_agent_channels";
const KEY_SIGNATURE = "sales_agent_signature";
const KEY_FOLLOWUP = "sales_followup_enabled";
const KEY_DISCLOSE_AI = "sales_agent_disclose_ai";
const KEY_DISCLOSURE = "sales_agent_disclosure";
const KEY_HANDOFF_ACK = "sales_agent_handoff_ack";
// Appends "...antworte mit STOP" to proactive messages (opener + nudges).
// Default OFF so the test system reads human; turn ON before real customers
// for §7 UWG / Art. 21 DSGVO compliance.
const KEY_OPTOUT_LINE = "sales_agent_optout_line";
// First-contact engine (proactive WhatsApp outreach to fresh ImmoScout leads).
const KEY_FIRST_CONTACT = "sales_first_contact_enabled";
// Set to the enable timestamp every time the switch flips ON. The engine only
// ever touches leads CREATED AFTER this moment, so enabling it can never blast
// a stale backlog (the 2026-06-03 live-run failure mode).
const KEY_FIRST_CONTACT_ENABLED_AT = "sales_first_contact_enabled_at";
const KEY_FIRST_CONTACT_ACCOUNT = "sales_first_contact_channel_account_id";
const KEY_FIRST_CONTACT_TEMPLATE = "sales_first_contact_template";
const KEY_FIRST_CONTACT_TEMPLATE_PARAMS = "sales_first_contact_template_params";
const KEY_FIRST_CONTACT_DAILY_CAP = "sales_first_contact_daily_cap";
const KEY_FIRST_CONTACT_SIGNATURE = "sales_first_contact_signature";

export const DEFAULT_FIRST_CONTACT_DAILY_CAP = 30;
/** Default WABA template body params (token-substituted at send time). */
export const DEFAULT_FIRST_CONTACT_TEMPLATE_PARAMS = "{name}";
/**
 * Sender line under the first-contact opener (owner's wording, 2026-06-11).
 * A leading "<Vorname> von ..." pattern doubles as the agent's persona: the
 * opener then introduces itself with that first name ("ich bin Dario von ...").
 */
export const DEFAULT_FIRST_CONTACT_SIGNATURE =
  "Dario von Kottke-Umzügen (Partner der Immobilien Scout GmbH)";

/** Channel types the agent is allowed to act on, by default. KA rides on email. */
export const DEFAULT_AGENT_CHANNELS = ["whatsapp", "email"] as const;

/**
 * Default closing signature. Launch is Kottke-first; the brand must never be
 * chosen by the model. When Ceylan is added this should become channel-routed.
 */
export const DEFAULT_AGENT_SIGNATURE = "Kottke Umzüge";

/**
 * First-message AI disclosure. REQUIRED for compliance: EU AI Act Art. 50(1)+(5)
 * mandates a clear, distinguishable disclosure that the counterpart is automated,
 * at the latest at the first interaction (in force from 2 Aug 2026; already
 * prudent under German UWG). Prepended deterministically to the agent's first
 * customer-facing message in a thread, so the model can never skip it. Editing
 * the wording is fine; an empty value falls back to this default (it cannot be
 * disabled, by design).
 */
export const DEFAULT_AGENT_DISCLOSURE =
  "Kurzer Hinweis: Hier antwortet zunächst unser KI-Assistent, damit Sie sofort eine Rückmeldung bekommen. Ein Mitarbeiter erstellt Ihnen anschließend Ihr persönliches Angebot und ist bei Fragen jederzeit für Sie da.";

/**
 * Short, neutral acknowledgment sent to the customer at handoff (warm transfer,
 * sets expectations, contains NO price). Set to an empty string to send nothing
 * on handoff (then only the owner is notified).
 */
export const DEFAULT_AGENT_HANDOFF_ACK =
  "Vielen Dank, das reicht mir fürs Erste. Ich verweise dich jetzt an einen Kollegen, der sich mit einem persönlichen Angebot bei dir meldet.";

export interface AgentSettings {
  enabled: boolean;
  dryRun: boolean;
  channels: string[];
  signature: string;
  followupEnabled: boolean;
  discloseAi: boolean;
  disclosure: string;
  handoffAck: string;
  optOutLine: boolean;
  firstContactEnabled: boolean;
  firstContactChannelAccountId: string | null;
  firstContactTemplate: string;
  firstContactTemplateParams: string;
  firstContactDailyCap: number;
  firstContactSignature: string;
}

export async function isSalesAgentEnabled(workspaceId: string): Promise<boolean> {
  return (await getSetting(workspaceId, KEY_ENABLED)) === "true";
}

/** Default true: unset means dry-run, so going live is always an explicit choice. */
export async function isSalesAgentDryRun(workspaceId: string): Promise<boolean> {
  return (await getSetting(workspaceId, KEY_DRY_RUN)) !== "false";
}

/** Follow-up engine on/off, independent of the reply agent. Default OFF. */
export async function isSalesFollowupEnabled(workspaceId: string): Promise<boolean> {
  return (await getSetting(workspaceId, KEY_FOLLOWUP)) === "true";
}

export async function getAgentChannels(workspaceId: string): Promise<string[]> {
  const raw = await getSetting(workspaceId, KEY_CHANNELS);
  if (!raw) return [...DEFAULT_AGENT_CHANNELS];
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_AGENT_CHANNELS];
}

export async function getAgentSignature(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_SIGNATURE);
  return raw && raw.trim() ? raw.trim() : DEFAULT_AGENT_SIGNATURE;
}

/**
 * Whether the agent prepends the AI disclosure on first contact. Default OFF
 * (owner decision 2026-06-03: a closed 1-week friends test runs without
 * disclosure; the owner enables it himself before real customers). NOTE: from
 * 2 Aug 2026 EU AI Act Art. 50 makes disclosure mandatory for consumer-facing
 * bots, so this must be turned ON before serving real customers.
 */
export async function isDiscloseAiEnabled(workspaceId: string): Promise<boolean> {
  return (await getSetting(workspaceId, KEY_DISCLOSE_AI)) === "true";
}

/** Empty/unset falls back to the default text (used only when disclosure is ON). */
export async function getAgentDisclosure(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_DISCLOSURE);
  return raw && raw.trim() ? raw.trim() : DEFAULT_AGENT_DISCLOSURE;
}

/** Unset falls back to the default; an explicit empty string means "send no ack". */
export async function getAgentHandoffAck(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_HANDOFF_ACK);
  return raw === null ? DEFAULT_AGENT_HANDOFF_ACK : raw;
}

/**
 * Whether to append the "antworte mit STOP" opt-out line to proactive messages
 * (first-contact opener + follow-up nudges). Default OFF so the test system
 * reads human; the owner turns it ON before serving real customers (then it is
 * the §7 UWG / Art. 21 DSGVO safe path). Inbound STOP is ALWAYS honored either
 * way — this only controls whether we advertise it in the message.
 */
export async function isOptOutLineEnabled(workspaceId: string): Promise<boolean> {
  return (await getSetting(workspaceId, KEY_OPTOUT_LINE)) === "true";
}

/** First-contact engine on/off, independent of the reply agent. Default OFF. */
export async function isFirstContactEnabled(workspaceId: string): Promise<boolean> {
  return (await getSetting(workspaceId, KEY_FIRST_CONTACT)) === "true";
}

/**
 * The ISO timestamp of the most recent OFF->ON flip. The engine refuses to run
 * without it (fail-safe) and only contacts leads created after it.
 */
export async function getFirstContactEnabledAt(workspaceId: string): Promise<Date | null> {
  const raw = await getSetting(workspaceId, KEY_FIRST_CONTACT_ENABLED_AT);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The WhatsApp channel account (WABA or in-house Baileys) used for first contact. */
export async function getFirstContactChannelAccountId(workspaceId: string): Promise<string | null> {
  const raw = await getSetting(workspaceId, KEY_FIRST_CONTACT_ACCOUNT);
  return raw && raw.trim() ? raw.trim() : null;
}

/** WABA-only: the approved template used to open the conversation. */
export async function getFirstContactTemplate(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_FIRST_CONTACT_TEMPLATE);
  return raw?.trim() ?? "";
}

/** WABA-only: comma-separated body params with {name}/{vorname}/{von}/{nach}/{route}/{datum} tokens. */
export async function getFirstContactTemplateParams(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_FIRST_CONTACT_TEMPLATE_PARAMS);
  return raw && raw.trim() ? raw.trim() : DEFAULT_FIRST_CONTACT_TEMPLATE_PARAMS;
}

/** Hard cap on first-contact attempts (live + dry-run) per calendar day. */
export async function getFirstContactDailyCap(workspaceId: string): Promise<number> {
  const raw = await getSetting(workspaceId, KEY_FIRST_CONTACT_DAILY_CAP);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FIRST_CONTACT_DAILY_CAP;
}

/** Sender line under the opener; empty/unset falls back to the default. */
export async function getFirstContactSignature(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_FIRST_CONTACT_SIGNATURE);
  return raw && raw.trim() ? raw.trim() : DEFAULT_FIRST_CONTACT_SIGNATURE;
}

export async function getAgentSettings(workspaceId: string): Promise<AgentSettings> {
  const [enabled, dryRun, channels, signature, followupEnabled, discloseAi, disclosure, handoffAck, optOutLine] =
    await Promise.all([
      isSalesAgentEnabled(workspaceId),
      isSalesAgentDryRun(workspaceId),
      getAgentChannels(workspaceId),
      getAgentSignature(workspaceId),
      isSalesFollowupEnabled(workspaceId),
      isDiscloseAiEnabled(workspaceId),
      getAgentDisclosure(workspaceId),
      getAgentHandoffAck(workspaceId),
      isOptOutLineEnabled(workspaceId),
    ]);
  const [
    firstContactEnabled,
    firstContactChannelAccountId,
    firstContactTemplate,
    firstContactTemplateParams,
    firstContactDailyCap,
    firstContactSignature,
  ] = await Promise.all([
    isFirstContactEnabled(workspaceId),
    getFirstContactChannelAccountId(workspaceId),
    getFirstContactTemplate(workspaceId),
    getFirstContactTemplateParams(workspaceId),
    getFirstContactDailyCap(workspaceId),
    getFirstContactSignature(workspaceId),
  ]);
  return {
    enabled,
    dryRun,
    channels,
    signature,
    followupEnabled,
    discloseAi,
    disclosure,
    handoffAck,
    optOutLine,
    firstContactEnabled,
    firstContactChannelAccountId,
    firstContactTemplate,
    firstContactTemplateParams,
    firstContactDailyCap,
    firstContactSignature,
  };
}

export async function setAgentSettings(
  workspaceId: string,
  patch: {
    enabled?: boolean;
    dryRun?: boolean;
    channels?: string[];
    signature?: string;
    followupEnabled?: boolean;
    discloseAi?: boolean;
    disclosure?: string;
    handoffAck?: string;
    optOutLine?: boolean;
    firstContactEnabled?: boolean;
    firstContactChannelAccountId?: string | null;
    firstContactTemplate?: string;
    firstContactTemplateParams?: string;
    firstContactDailyCap?: number;
    firstContactSignature?: string;
  }
): Promise<AgentSettings> {
  if (patch.optOutLine !== undefined) {
    await setSetting(workspaceId, KEY_OPTOUT_LINE, patch.optOutLine ? "true" : "false");
  }
  if (patch.firstContactEnabled !== undefined) {
    const wasEnabled = await isFirstContactEnabled(workspaceId);
    await setSetting(workspaceId, KEY_FIRST_CONTACT, patch.firstContactEnabled ? "true" : "false");
    // Every OFF->ON flip re-stamps the watermark, so only leads arriving from
    // now on are auto-contacted. Old leads stay untouched, always.
    if (patch.firstContactEnabled && !wasEnabled) {
      await setSetting(workspaceId, KEY_FIRST_CONTACT_ENABLED_AT, new Date().toISOString());
    }
  }
  if (patch.firstContactChannelAccountId !== undefined) {
    await setSetting(
      workspaceId,
      KEY_FIRST_CONTACT_ACCOUNT,
      patch.firstContactChannelAccountId?.trim() ?? ""
    );
  }
  if (patch.firstContactTemplate !== undefined) {
    await setSetting(workspaceId, KEY_FIRST_CONTACT_TEMPLATE, patch.firstContactTemplate.trim());
  }
  if (patch.firstContactTemplateParams !== undefined) {
    await setSetting(
      workspaceId,
      KEY_FIRST_CONTACT_TEMPLATE_PARAMS,
      patch.firstContactTemplateParams.trim()
    );
  }
  if (patch.firstContactDailyCap !== undefined) {
    const n = Math.max(1, Math.floor(patch.firstContactDailyCap));
    await setSetting(workspaceId, KEY_FIRST_CONTACT_DAILY_CAP, String(n));
  }
  if (patch.firstContactSignature !== undefined) {
    await setSetting(workspaceId, KEY_FIRST_CONTACT_SIGNATURE, patch.firstContactSignature.trim());
  }
  if (patch.followupEnabled !== undefined) {
    await setSetting(workspaceId, KEY_FOLLOWUP, patch.followupEnabled ? "true" : "false");
  }
  if (patch.discloseAi !== undefined) {
    await setSetting(workspaceId, KEY_DISCLOSE_AI, patch.discloseAi ? "true" : "false");
  }
  if (patch.disclosure !== undefined) {
    await setSetting(workspaceId, KEY_DISCLOSURE, patch.disclosure);
  }
  if (patch.handoffAck !== undefined) {
    await setSetting(workspaceId, KEY_HANDOFF_ACK, patch.handoffAck);
  }
  if (patch.enabled !== undefined) {
    await setSetting(workspaceId, KEY_ENABLED, patch.enabled ? "true" : "false");
  }
  if (patch.dryRun !== undefined) {
    await setSetting(workspaceId, KEY_DRY_RUN, patch.dryRun ? "true" : "false");
  }
  if (patch.channels !== undefined) {
    const cleaned = patch.channels
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    await setSetting(
      workspaceId,
      KEY_CHANNELS,
      (cleaned.length > 0 ? cleaned : DEFAULT_AGENT_CHANNELS).join(",")
    );
  }
  if (patch.signature !== undefined) {
    const sig = patch.signature.trim() || DEFAULT_AGENT_SIGNATURE;
    await setSetting(workspaceId, KEY_SIGNATURE, sig);
  }
  return getAgentSettings(workspaceId);
}
