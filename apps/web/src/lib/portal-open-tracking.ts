/**
 * Pure rules for customer-portal open tracking.
 *
 * Page renders do not count. Link-preview crawlers (WhatsApp, Telegram,
 * Facebook, iMessage, Slack, Googlebot, …) and HEAD requests never count.
 * Customer-facing numbers come from real browser sessions in
 * `customer_portal_visits`, minus internal / pre-send rows.
 *
 * `sent_at` on `customer_status_links` is the first outbound customer message
 * whose body contains `/s/<token>` (see markCustomerLinkSentFromOutbound).
 * Until that timestamp, new visits are pre-send. A logged-in CRM session
 * (same cookie the CRM app uses) and the operator "Öffnen" button
 * (`utm_source=share_panel`, not the URL copied to the customer) are internal.
 * Internal rows are stored and labeled "intern/Test"; they are excluded from
 * customer counts and from deal-timeline activity.
 */

export const DOCUMENT_VIEW_DEDUPE_MS = 45_000;

export type InternalReason = "crm_session" | "pre_send" | "share_panel";

export interface PortalAudience {
  internal: boolean;
  reason: InternalReason | null;
}

const CRAWLER_RE =
  /whatsapp|telegrambot|facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|skypeuripreview|applebot|googlebot|google-inspectiontool|adsbot-google|mediapartners-google|storebot-google|googleother|bingbot|linkedinbot|discordbot|embedly|pinterestbot|redditbot|vkshare|petalbot|bytespider|semrushbot|ahrefsbot|dotbot|yandexbot|baiduspider|duckduckbot|bitlybot|snapchat|viber|kakaotalk|iframely|meta-externalagent|meta-externalfetcher|chrome-lighthouse|ia_archiver|qwantify|telegrambot/i;

/** Link-preview and search crawlers. Empty user agents are not crawlers. */
export function isLinkPreviewCrawler(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return false;
  if (CRAWLER_RE.test(ua)) return true;
  // Apple Messages link preview (the classic combined bot UA, plus the
  // Messages-specific token some iOS versions send).
  if (/messages\//i.test(ua) || /com\.apple\.mobilesms/i.test(ua)) return true;
  return false;
}

/** False for HEAD and for link-preview crawlers. Everything else may count. */
export function shouldRecordPortalHit(input: {
  method: string | null | undefined;
  userAgent: string | null | undefined;
}): boolean {
  const method = (input.method ?? "GET").toUpperCase();
  if (method === "HEAD") return false;
  if (isLinkPreviewCrawler(input.userAgent)) return false;
  return true;
}

export function classifyPortalAudience(input: {
  crmUserId: string | null;
  openedAt: Date;
  /** Null when the link has not been seen in an outbound message yet. */
  sentAt: Date | null;
  /**
   * False only when `sent_at` is not migrated yet. Then we must not treat
   * every visit as pre-send, or customer counts would drop to zero.
   */
  sentSignalAvailable: boolean;
  channel: string | null;
}): PortalAudience {
  if (input.crmUserId) return { internal: true, reason: "crm_session" };
  if (input.channel === "share_panel") return { internal: true, reason: "share_panel" };
  if (!input.sentSignalAvailable) return { internal: false, reason: null };
  if (input.sentAt == null || input.openedAt.getTime() < input.sentAt.getTime()) {
    return { internal: true, reason: "pre_send" };
  }
  return { internal: false, reason: null };
}

/**
 * A document fetch inherits the session's internal flag (the beacon already
 * classified the browser). A CRM cookie on this request still wins, so an
 * operator opening the PDF on the CRM host is internal even if the session
 * row was created without the cookie.
 */
export function documentAudience(input: {
  request: {
    crmUserId: string | null;
    openedAt: Date;
    sentAt: Date | null;
    sentSignalAvailable: boolean;
    channel: string | null;
  };
  sessionInternal: boolean | null;
  sessionReason: InternalReason | null;
}): PortalAudience {
  const fromRequest = classifyPortalAudience(input.request);
  if (fromRequest.internal) return fromRequest;
  if (input.sessionInternal) {
    return { internal: true, reason: input.sessionReason ?? "crm_session" };
  }
  return fromRequest;
}

export function internalVisitLabel(reason: InternalReason | null): string | null {
  if (!reason) return null;
  return "intern/Test";
}

/**
 * PDF viewers issue several Range requests for one open. A later range from
 * the same session inside the window is not a new view. A full GET (download
 * or first open without Range) is not collapsed.
 */
export function shouldDedupeDocumentView(input: {
  hasRange: boolean;
  lastViewedAt: Date | null;
  now: Date;
  windowMs?: number;
}): boolean {
  if (!input.hasRange || !input.lastViewedAt) return false;
  const windowMs = input.windowMs ?? DOCUMENT_VIEW_DEDUPE_MS;
  return input.now.getTime() - input.lastViewedAt.getTime() < windowMs;
}

/** One new customer session → one "Statuslink geöffnet". Heartbeats and internal sessions do not. */
export function shouldRecordPortalOpenActivity(input: {
  isNewSession: boolean;
  internal: boolean;
}): boolean {
  return input.isNewSession && !input.internal;
}

/** First non-internal view of a document. Range repeats and later views do not. */
export function shouldRecordDocumentActivity(input: {
  internal: boolean;
  deduped: boolean;
  priorCustomerViews: number;
}): boolean {
  return !input.internal && !input.deduped && input.priorCustomerViews === 0;
}

export function portalActivityTitle(
  eventType: string,
  payload: Record<string, unknown>
): string | null {
  if (eventType === "customer.portal_opened") return "Statuslink geöffnet";
  if (eventType === "customer.document_viewed") {
    const kind = typeof payload.documentType === "string" ? payload.documentType : "";
    if (kind === "quotation" || kind === "") return "Angebot (PDF) angesehen";
    return "PDF angesehen";
  }
  return null;
}

export function portalActivityDescription(
  eventType: string,
  payload: Record<string, unknown>
): string | undefined {
  if (eventType === "customer.portal_opened") {
    const channel = typeof payload.channel === "string" ? payload.channel : "";
    if (channel && channel !== "unknown" && channel !== "share_panel") return channel;
    return undefined;
  }
  if (eventType === "customer.document_viewed") {
    const name = typeof payload.fileName === "string" ? payload.fileName : "";
    const disposition =
      payload.disposition === "download"
        ? "Download"
        : payload.disposition === "inline"
          ? "Ansicht"
          : "";
    const text = [name, disposition].filter(Boolean).join(" · ");
    return text || undefined;
  }
  return undefined;
}

/** True when `body` contains this link and not merely a longer token that shares the prefix. */
export function bodyContainsPortalToken(body: string | null | undefined, token: string): boolean {
  if (!body || !token) return false;
  const needle = `/s/${token}`;
  let from = 0;
  while (from < body.length) {
    const at = body.indexOf(needle, from);
    if (at < 0) return false;
    const next = body[at + needle.length];
    if (!next || !/[A-Za-z0-9_-]/.test(next)) return true;
    from = at + needle.length;
  }
  return false;
}

const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function portalSessionFromRequest(input: {
  sid: string | null | undefined;
  cookie: string | null | undefined;
}): string | null {
  const fromQuery = (input.sid ?? "").trim();
  if (SESSION_RE.test(fromQuery)) return fromQuery;
  const cookie = input.cookie ?? "";
  const match = cookie.match(/(?:^|;\s*)kottke_portal_sid=([^;]+)/);
  if (!match) return null;
  let value = match[1] ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  return SESSION_RE.test(value) ? value : null;
}

export function documentDisposition(download: boolean): "inline" | "download" {
  return download ? "download" : "inline";
}
