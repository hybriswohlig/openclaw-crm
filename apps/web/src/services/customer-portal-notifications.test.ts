import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const st = {
    ocId: null as string | null,
    modus: "aus" as "aus" | "entwurf" | "senden",
    firma: "Kottke Umzüge",
  };
  return {
    st,
    sendEmail: vi.fn(async () => ({ sent: true })),
    ladeModus: vi.fn(async () => ({ modus: st.modus, seit: null, hakenPortal: false })),
  };
});

vi.mock("@/db", () => {
  function kette(rows: unknown[]) {
    const k: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin"]) k[m] = () => k;
    k.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, err);
    return k;
  }
  return {
    db: {
      select: () => ({ from: () => kette([]) }),
      execute: async () => (h.st.ocId ? [{ id: h.st.ocId }] : []),
    },
  };
});
vi.mock("@/services/workspace-settings", () => ({ getSetting: async () => "true" }));
vi.mock("@/services/activity-events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/services/customer-portal-data", () => ({
  ensureCustomerStatusLink: async () => ({ token: "tok_portal" }),
  loadContextByToken: async () => ({
    meta: { revoked: false, featureDisabled: false },
    customerDisplayName: "Anna Berger",
    dealNumber: "2026-014",
    branding: { displayName: h.st.firma, googleReviewUrl: "https://g.page/r/test/review" },
  }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ sendPortalNotificationEmail: h.sendEmail }));
vi.mock("@/services/inbox-whatsapp", () => ({ sendWhatsAppReply: vi.fn(), sendBaileysReply: vi.fn() }));
vi.mock("@/services/bewertung-modus", () => ({ ladeBewertungModus: h.ladeModus }));

import { maybeNotifyPortalEvent } from "./customer-portal-notifications";

const HINWEIS =
  "Über eine Google-Bewertung würden wir uns sehr freuen. Auch dort führt der Link direkt zum richtigen Formular.";
const DU =
  "Vielen Dank für deinen Umzug (Auftrag 2026-014)! Deine Rechnung sowie die Möglichkeit zur sofortigen Überweisung per QR-Code findest du im Status-Portal.";
const SIE =
  "Vielen Dank für Ihren Umzug (Auftrag 2026-014)! Ihre Rechnung sowie die Möglichkeit zur sofortigen Überweisung per QR-Code finden Sie im Status-Portal.";

async function inhalt() {
  h.sendEmail.mockClear();
  h.ladeModus.mockClear();
  await maybeNotifyPortalEvent("invoice_ready", { workspaceId: "ws_1", dealRecordId: "deal_1" });
  const arg = (h.sendEmail.mock.calls as unknown[][])[0]?.[0] as {
    subject: string;
    paragraphs: string[];
    ctaLabel: string;
  };
  return arg;
}

describe("Rechnungsnachricht und Google-Hinweis", () => {
  const vorher = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://crm.example";
    h.st.ocId = "oc_1";
    h.st.modus = "aus";
    h.st.firma = "Kottke Umzüge";
    h.sendEmail.mockClear();
    h.ladeModus.mockClear();
  });

  it("Modus aus und unbekannte Firma behalten den Hinweis, Entwurf und Senden nicht", async () => {
    const aus = await inhalt();
    expect(h.ladeModus).toHaveBeenCalledWith("ws_1", "oc_1");
    expect(aus.ctaLabel).toBe("Zur Rechnung");
    expect(aus.subject).toBe("Deine Rechnung (Auftrag 2026-014) bei Kottke Umzüge");
    expect(aus.paragraphs).toEqual(["Hallo Anna,", DU, HINWEIS]);

    h.st.ocId = null;
    const ohneFirma = await inhalt();
    expect(h.ladeModus).not.toHaveBeenCalled();
    expect(ohneFirma).toEqual(aus);

    h.st.ocId = "oc_1";
    h.st.modus = "entwurf";
    const entwurf = await inhalt();
    expect(entwurf.paragraphs).toEqual(["Hallo Anna,", DU]);
    expect(entwurf.subject).toBe(aus.subject);
    expect(entwurf.paragraphs.join("\n")).not.toContain(HINWEIS);

    h.st.modus = "senden";
    const senden = await inhalt();
    expect(senden.paragraphs).toEqual(entwurf.paragraphs);
    expect(senden.subject).toBe(aus.subject);
  });

  it("Sie-Text bleibt gleich, nur der Hinweis fällt weg", async () => {
    h.st.firma = "Ceylan Umzüge";
    h.st.modus = "aus";
    const aus = await inhalt();
    expect(aus.subject).toBe("Ihre Rechnung (Auftrag 2026-014) bei Ceylan Umzüge");
    expect(aus.paragraphs).toEqual(["Hallo Anna,", SIE, HINWEIS]);

    h.st.modus = "entwurf";
    const entwurf = await inhalt();
    expect(entwurf.subject).toBe(aus.subject);
    expect(entwurf.paragraphs).toEqual(["Hallo Anna,", SIE]);

    h.st.modus = "senden";
    const senden = await inhalt();
    expect(senden.paragraphs).toEqual(entwurf.paragraphs);
    expect(senden.ctaLabel).toBe("Zur Rechnung");
  });

  afterAll(() => {
    if (vorher === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = vorher;
  });
});
