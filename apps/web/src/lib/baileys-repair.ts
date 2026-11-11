/**
 * Re-pair an existing in-house Baileys channel account without minting a
 * second row. Conversations stay on the same channel_accounts id.
 *
 * The banner link used to be a plain `/integrations` href. On that page the
 * App Router treats the click as a same-route navigation and does nothing,
 * which is why "Jetzt verbinden" was a no-op on the iPhone.
 */

export const BAILEYS_REPAIR_QUERY = "baileysRepair";
/** Several accounts are down: scroll the channel list instead of picking one. */
export const BAILEYS_REPAIR_LIST = "list";
export const BAILEYS_REPAIR_EVENT = "kottke:baileys-repair";
export const KANAL_ACCOUNTS_ANCHOR = "kanal-accounts";

/** Encrypted Baileys auth blob in workspace_settings. One key per account. */
export function baileysAuthStateKey(accountId: string): string {
  return `baileys.auth_state.${accountId}`;
}

export interface BaileysRepairAccount {
  id: string;
  channelType: string;
  baileysBridgeProvider: string | null;
  isActive: boolean;
  baileysPairingStatus: string | null;
}

/** In-house Baileys row that is not currently active and connected. */
export function isInhouseBaileysDown(acc: BaileysRepairAccount): boolean {
  return (
    acc.channelType === "whatsapp" &&
    acc.baileysBridgeProvider === "inhouse" &&
    !(acc.isActive && acc.baileysPairingStatus === "connected")
  );
}

/**
 * `repair` clears this account's auth blob so the bridge prints a fresh QR.
 * `resume` only restarts the socket (in-progress scan, or a voluntary stop
 * that left a still-valid session). `null` means the row is healthy.
 */
export type BaileysRepairMode = "repair" | "resume";

const LIVE_PAIRING = new Set(["awaiting_qr", "awaiting_code", "connecting"]);

export function baileysRepairMode(acc: BaileysRepairAccount): BaileysRepairMode | null {
  if (acc.channelType !== "whatsapp" || acc.baileysBridgeProvider !== "inhouse") {
    return null;
  }
  if (acc.isActive && acc.baileysPairingStatus === "connected") return null;
  // A scan already in progress must not wipe the QR the operator is looking at.
  if (acc.isActive && acc.baileysPairingStatus && LIVE_PAIRING.has(acc.baileysPairingStatus)) {
    return "resume";
  }
  // Voluntary "Trennen" leaves status=connected and isActive=false. The
  // session is still valid; restart it instead of forcing a new QR.
  if (!acc.isActive && acc.baileysPairingStatus === "connected") return "resume";
  // logged_out, idle, error, null, or inactive without a live session.
  return "repair";
}

export function baileysRepairHref(down: { id: string }[]): string {
  if (down.length === 1) {
    return `/integrations?${BAILEYS_REPAIR_QUERY}=${encodeURIComponent(down[0]!.id)}`;
  }
  if (down.length > 1) {
    return `/integrations?${BAILEYS_REPAIR_QUERY}=${BAILEYS_REPAIR_LIST}#${KANAL_ACCOUNTS_ANCHOR}`;
  }
  return "/integrations";
}

export function repairTargetFromHref(href: string): string | null {
  try {
    const url = new URL(href, "https://crm.local");
    const raw = url.searchParams.get(BAILEYS_REPAIR_QUERY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function isIntegrationsPath(pathname: string): boolean {
  return pathname === "/integrations" || pathname === "/integrations/";
}

/**
 * Decide whether the banner click has to be handled on the current page.
 * A modified click (new tab) and a click from any other route stay on the
 * real link so the browser / Next router can navigate.
 */
export function handleBaileysRepairClick(args: {
  pathname: string;
  href: string;
  modified: boolean;
}): { preventDefault: boolean; target: string | null } {
  if (args.modified || !isIntegrationsPath(args.pathname)) {
    return { preventDefault: false, target: null };
  }
  return { preventDefault: true, target: repairTargetFromHref(args.href) };
}
