import { describe, expect, it } from "vitest";
import {
  DOCUMENT_VIEW_DEDUPE_MS,
  bodyContainsPortalToken,
  classifyPortalAudience,
  documentAudience,
  documentDisposition,
  internalVisitLabel,
  resolveCustomerOpenCounts,
  isLinkPreviewCrawler,
  portalActivityTitle,
  portalSessionFromRequest,
  shouldDedupeDocumentView,
  shouldRecordDocumentActivity,
  shouldRecordPortalHit,
  shouldRecordPortalOpenActivity,
} from "./portal-open-tracking";

const OPENED = new Date("2026-11-02T12:00:00.000Z");
const SENT_BEFORE = new Date("2026-11-01T09:00:00.000Z");
const SENT_AFTER = new Date("2026-11-02T18:00:00.000Z");

describe("bot and HEAD filtering", () => {
  const crawlers = [
    ["WhatsApp", "WhatsApp/2.23.20.0"],
    ["Telegram", "TelegramBot (like TwitterBot)"],
    ["Facebook", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["Facebot", "Facebot"],
    ["iMessage", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0"],
    ["Slack", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    ["Slack image", "Slack-ImgProxy"],
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["Twitter", "Twitterbot/1.0"],
    ["Discord", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
  ];

  it.each(crawlers)("does not count %s", (_name, ua) => {
    expect(isLinkPreviewCrawler(ua)).toBe(true);
    expect(shouldRecordPortalHit({ method: "GET", userAgent: ua })).toBe(false);
  });

  it("counts a normal browser and an empty user agent", () => {
    const chrome =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(shouldRecordPortalHit({ method: "GET", userAgent: chrome })).toBe(true);
    expect(shouldRecordPortalHit({ method: "POST", userAgent: "" })).toBe(true);
    expect(shouldRecordPortalHit({ method: "GET", userAgent: null })).toBe(true);
  });

  it("never counts HEAD, even from a real browser", () => {
    expect(
      shouldRecordPortalHit({
        method: "HEAD",
        userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      })
    ).toBe(false);
    expect(shouldRecordPortalHit({ method: "head", userAgent: "curl/8.0" })).toBe(false);
  });
});

describe("internal flagging", () => {
  it("marks a logged-in CRM user as intern/Test even after the link was sent", () => {
    const audience = classifyPortalAudience({
      crmUserId: "usr_dario",
      openedAt: OPENED,
      sentAt: SENT_BEFORE,
      sentSignalAvailable: true,
      channel: "whatsapp",
    });
    expect(audience).toEqual({ internal: true, reason: "crm_session" });
    expect(internalVisitLabel(audience.reason)).toBe("intern/Test");
  });

  it("marks the operator Öffnen button (share_panel) as internal", () => {
    expect(
      classifyPortalAudience({
        crmUserId: null,
        openedAt: OPENED,
        sentAt: SENT_BEFORE,
        sentSignalAvailable: true,
        channel: "share_panel",
      })
    ).toEqual({ internal: true, reason: "share_panel" });
  });

  it("marks visits before the link was sent, and visits while it was never sent", () => {
    expect(
      classifyPortalAudience({
        crmUserId: null,
        openedAt: OPENED,
        sentAt: SENT_AFTER,
        sentSignalAvailable: true,
        channel: "unknown",
      })
    ).toEqual({ internal: true, reason: "pre_send" });
    expect(
      classifyPortalAudience({
        crmUserId: null,
        openedAt: OPENED,
        sentAt: null,
        sentSignalAvailable: true,
        channel: null,
      }).reason
    ).toBe("pre_send");
  });

  it("counts a customer session that starts after the link was sent", () => {
    expect(
      classifyPortalAudience({
        crmUserId: null,
        openedAt: OPENED,
        sentAt: SENT_BEFORE,
        sentSignalAvailable: true,
        channel: "whatsapp",
      })
    ).toEqual({ internal: false, reason: null });
    expect(internalVisitLabel(null)).toBeNull();
  });

  it("does not treat every visit as pre-send when sent_at is not migrated yet", () => {
    expect(
      classifyPortalAudience({
        crmUserId: null,
        openedAt: OPENED,
        sentAt: null,
        sentSignalAvailable: false,
        channel: null,
      }).internal
    ).toBe(false);
  });

  it("inherits an internal session onto a PDF fetch, unless this request is itself internal", () => {
    expect(
      documentAudience({
        request: {
          crmUserId: null,
          openedAt: OPENED,
          sentAt: SENT_BEFORE,
          sentSignalAvailable: true,
          channel: null,
        },
        sessionInternal: true,
        sessionReason: "pre_send",
      })
    ).toEqual({ internal: true, reason: "pre_send" });

    expect(
      documentAudience({
        request: {
          crmUserId: "usr_1",
          openedAt: OPENED,
          sentAt: SENT_BEFORE,
          sentSignalAvailable: true,
          channel: null,
        },
        sessionInternal: false,
        sessionReason: null,
      }).reason
    ).toBe("crm_session");
  });
});

describe("PDF range dedupe", () => {
  const now = new Date("2026-11-02T12:00:45.000Z");

  it("collapses range repeats from the same session inside the window", () => {
    expect(
      shouldDedupeDocumentView({
        hasRange: true,
        lastViewedAt: new Date(now.getTime() - (DOCUMENT_VIEW_DEDUPE_MS - 1)),
        now,
      })
    ).toBe(true);
  });

  it("counts a range again once the window has passed", () => {
    expect(
      shouldDedupeDocumentView({
        hasRange: true,
        lastViewedAt: new Date(now.getTime() - DOCUMENT_VIEW_DEDUPE_MS),
        now,
      })
    ).toBe(false);
  });

  it("does not dedupe a full GET or the first range", () => {
    expect(
      shouldDedupeDocumentView({
        hasRange: false,
        lastViewedAt: new Date(now.getTime() - 1000),
        now,
      })
    ).toBe(false);
    expect(shouldDedupeDocumentView({ hasRange: true, lastViewedAt: null, now })).toBe(false);
  });

  it("reads download vs inline from the link the customer used", () => {
    expect(documentDisposition(true)).toBe("download");
    expect(documentDisposition(false)).toBe("inline");
  });
});

describe("activity rate limit", () => {
  it("writes Statuslink geöffnet once per new customer session, not on heartbeats or internal opens", () => {
    expect(shouldRecordPortalOpenActivity({ isNewSession: true, internal: false })).toBe(true);
    expect(shouldRecordPortalOpenActivity({ isNewSession: false, internal: false })).toBe(false);
    expect(shouldRecordPortalOpenActivity({ isNewSession: true, internal: true })).toBe(false);
    expect(portalActivityTitle("customer.portal_opened", {})).toBe("Statuslink geöffnet");
  });

  it("writes Angebot (PDF) angesehen only for the first non-internal view of that document", () => {
    expect(
      shouldRecordDocumentActivity({ internal: false, deduped: false, priorCustomerViews: 0 })
    ).toBe(true);
    expect(
      shouldRecordDocumentActivity({ internal: false, deduped: false, priorCustomerViews: 1 })
    ).toBe(false);
    expect(
      shouldRecordDocumentActivity({ internal: false, deduped: true, priorCustomerViews: 0 })
    ).toBe(false);
    expect(
      shouldRecordDocumentActivity({ internal: true, deduped: false, priorCustomerViews: 0 })
    ).toBe(false);
    expect(
      portalActivityTitle("customer.document_viewed", { documentType: "quotation" })
    ).toBe("Angebot (PDF) angesehen");
    expect(
      portalActivityTitle("customer.document_viewed", { documentType: "invoice" })
    ).toBe("PDF angesehen");
  });
});

describe("sent signal", () => {
  const token = "abcdefghij1234567890ABCD";

  it("matches the portal token in an outbound message and ignores a longer token", () => {
    expect(bodyContainsPortalToken(`Hier der Link https://status.example/s/${token}`, token)).toBe(true);
    expect(bodyContainsPortalToken(`https://status.example/s/${token}extra`, token)).toBe(false);
    expect(bodyContainsPortalToken("kein link", token)).toBe(false);
  });

  it("reads the session id from the query or the portal cookie", () => {
    expect(portalSessionFromRequest({ sid: "session-1", cookie: null })).toBe("session-1");
    expect(
      portalSessionFromRequest({
        sid: "bad",
        cookie: "other=1; kottke_portal_sid=session-22",
      })
    ).toBe("session-22");
    expect(portalSessionFromRequest({ sid: "short", cookie: null })).toBeNull();
  });
});

describe("customer-facing counts", () => {
  const legacy = {
    viewCount: 4,
    sessionCount: 2,
    totalActiveMs: 90_000,
    firstViewedAt: "2026-10-01T10:00:00.000Z",
    lastViewedAt: "2026-10-02T10:00:00.000Z",
  };

  it("derives opens, sessions, active time and first/last from non-internal visits", () => {
    const counts = resolveCustomerOpenCounts({
      visitRowCount: 3,
      customerSessions: 1,
      customerActiveMs: 12_000,
      customerFirst: "2026-11-02T12:00:00.000Z",
      customerLast: "2026-11-02T12:05:00.000Z",
      legacy,
    });
    expect(counts).toEqual({
      viewCount: 1,
      sessionCount: 1,
      totalActiveMs: 12_000,
      firstViewedAt: "2026-11-02T12:00:00.000Z",
      lastViewedAt: "2026-11-02T12:05:00.000Z",
      countsSource: "sessions",
    });
  });

  it("keeps a zero customer count when every existing visit is internal", () => {
    const counts = resolveCustomerOpenCounts({
      visitRowCount: 2,
      customerSessions: 0,
      customerActiveMs: 0,
      customerFirst: null,
      customerLast: null,
      legacy,
    });
    expect(counts.countsSource).toBe("sessions");
    expect(counts.viewCount).toBe(0);
    expect(counts.sessionCount).toBe(0);
    expect(counts.totalActiveMs).toBe(0);
  });

  it("falls back to the stored columns when the link has no visit rows", () => {
    const counts = resolveCustomerOpenCounts({
      visitRowCount: 0,
      customerSessions: 9,
      customerActiveMs: 1,
      customerFirst: "2026-11-03T00:00:00.000Z",
      customerLast: "2026-11-03T00:00:00.000Z",
      legacy,
    });
    expect(counts).toEqual({ ...legacy, countsSource: "legacy" });
  });
});
