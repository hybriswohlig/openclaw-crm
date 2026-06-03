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
const KEY_DISCLOSURE = "sales_agent_disclosure";
const KEY_HANDOFF_ACK = "sales_agent_handoff_ack";

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
  "Vielen Dank, ich habe alle wichtigen Angaben. Ein Mitarbeiter erstellt Ihnen jetzt Ihr persönliches Angebot und meldet sich in Kürze bei Ihnen.";

export interface AgentSettings {
  enabled: boolean;
  dryRun: boolean;
  channels: string[];
  signature: string;
  followupEnabled: boolean;
  disclosure: string;
  handoffAck: string;
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

/** Empty/unset falls back to the default: the legal disclosure cannot be disabled. */
export async function getAgentDisclosure(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_DISCLOSURE);
  return raw && raw.trim() ? raw.trim() : DEFAULT_AGENT_DISCLOSURE;
}

/** Unset falls back to the default; an explicit empty string means "send no ack". */
export async function getAgentHandoffAck(workspaceId: string): Promise<string> {
  const raw = await getSetting(workspaceId, KEY_HANDOFF_ACK);
  return raw === null ? DEFAULT_AGENT_HANDOFF_ACK : raw;
}

export async function getAgentSettings(workspaceId: string): Promise<AgentSettings> {
  const [enabled, dryRun, channels, signature, followupEnabled, disclosure, handoffAck] =
    await Promise.all([
      isSalesAgentEnabled(workspaceId),
      isSalesAgentDryRun(workspaceId),
      getAgentChannels(workspaceId),
      getAgentSignature(workspaceId),
      isSalesFollowupEnabled(workspaceId),
      getAgentDisclosure(workspaceId),
      getAgentHandoffAck(workspaceId),
    ]);
  return { enabled, dryRun, channels, signature, followupEnabled, disclosure, handoffAck };
}

export async function setAgentSettings(
  workspaceId: string,
  patch: {
    enabled?: boolean;
    dryRun?: boolean;
    channels?: string[];
    signature?: string;
    followupEnabled?: boolean;
    disclosure?: string;
    handoffAck?: string;
  }
): Promise<AgentSettings> {
  if (patch.followupEnabled !== undefined) {
    await setSetting(workspaceId, KEY_FOLLOWUP, patch.followupEnabled ? "true" : "false");
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
