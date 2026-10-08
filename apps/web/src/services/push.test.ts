import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Wer aus dem Team entfernt oder abgelehnt wurde, bekam weiter Pushes mit
// Kundennamen und Nachrichtenvorschauen: sendPush suchte die Abos nur nach
// Workspace. Jetzt gehen Pushes nur an Abos von Benutzern, die gerade
// freigegebene CRM-Mitglieder dieses Workspace sind, auch wenn userIds sie
// ausdrücklich nennt. @/db ist hier ein Drizzle-Proxy (pg-proxy): Der Test
// sieht das echte SQL und liefert die Zeilen selbst, eine Datenbank gibt es
// nicht.
const mock = vi.hoisted(() => ({
  abfragen: [] as Array<{ sql: string; params: unknown[]; method: string }>,
  /** Antwort auf die Abo-Abfrage, Spalten in der Reihenfolge des select. */
  abos: [] as unknown[][],
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    db: drizzle(async (sql, params, method) => {
      mock.abfragen.push({ sql, params, method });
      return { rows: method === "all" ? mock.abos : [] };
    }),
  };
});

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mock.setVapidDetails,
    sendNotification: mock.sendNotification,
  },
}));

import { sendPush } from "./push";

const WORKSPACE = "ws_kottke";
const NACHRICHT = {
  title: "Anna Müller",
  body: "Kommen Sie am Freitag schon um 8 Uhr?",
  url: "/inbox?conv=conv-1",
};

/** Ein Abo, wie es die Abfrage liefert: id, userId, endpoint, p256dh, auth. */
function abo(id: string, userId: string) {
  return [id, userId, `https://push.example/${id}`, `p256dh-${id}`, `auth-${id}`];
}

// Ein Abo zählt nur mit Mitgliedschaft im selben Workspace und mit einem
// freigegebenen Konto, das kein Mitarbeiterportal-Konto ist.
const MITGLIED_JOIN =
  'inner join "workspace_members" on ("workspace_members"."workspace_id" = "push_subscriptions"."workspace_id" and "workspace_members"."user_id" = "push_subscriptions"."user_id")';
const KONTO_JOIN = 'inner join "users" on "users"."id" = "push_subscriptions"."user_id"';
const MITGLIED_FILTER =
  '"push_subscriptions"."workspace_id" = $1 and "users"."approval_status" = $2 and "users"."role" <> $3';

beforeEach(() => {
  vi.clearAllMocks();
  mock.abfragen.length = 0;
  mock.abos = [];
  vi.stubEnv("VAPID_PUBLIC_KEY", "test-public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
  mock.sendNotification.mockResolvedValue({ statusCode: 201 });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("sendPush", () => {
  it("schickt nur an Abos freigegebener CRM-Mitglieder dieses Workspace", async () => {
    mock.abos = [abo("sub_dario", "usr_dario"), abo("sub_mia", "usr_mia")];

    await expect(sendPush(NACHRICHT, { workspaceId: WORKSPACE })).resolves.toBe(2);

    expect(mock.abfragen).toHaveLength(1);
    const [{ sql, params }] = mock.abfragen;
    expect(sql).toContain(` from "push_subscriptions" ${MITGLIED_JOIN} ${KONTO_JOIN} `);
    expect(sql.endsWith(` where (${MITGLIED_FILTER})`)).toBe(true);
    expect(params).toEqual([WORKSPACE, "approved", "employee"]);

    expect(mock.sendNotification).toHaveBeenCalledTimes(2);
    expect(mock.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/sub_dario",
        keys: { p256dh: "p256dh-sub_dario", auth: "auth-sub_dario" },
      },
      JSON.stringify(NACHRICHT),
      { TTL: 60 * 60 }
    );
  });

  it("prüft Mitgliedschaft und Freigabe auch, wenn userIds die Empfänger nennen", async () => {
    // Jonas wurde entfernt: Sein Abo kommt aus der Abfrage nicht mehr zurück.
    mock.abos = [abo("sub_mia", "usr_mia")];

    await expect(
      sendPush(NACHRICHT, { workspaceId: WORKSPACE, userIds: ["usr_jonas", "usr_mia"] })
    ).resolves.toBe(1);

    const [{ sql, params }] = mock.abfragen;
    expect(sql).toContain(` from "push_subscriptions" ${MITGLIED_JOIN} ${KONTO_JOIN} `);
    expect(
      sql.endsWith(` where (${MITGLIED_FILTER} and "push_subscriptions"."user_id" in ($4, $5))`)
    ).toBe(true);
    expect(params).toEqual([WORKSPACE, "approved", "employee", "usr_jonas", "usr_mia"]);
    expect(mock.sendNotification).toHaveBeenCalledTimes(1);
    expect(mock.sendNotification.mock.calls[0][0]).toMatchObject({
      endpoint: "https://push.example/sub_mia",
    });
  });

  it("schickt nichts, wenn keiner der Empfänger mehr dazugehört", async () => {
    await expect(
      sendPush(NACHRICHT, { workspaceId: WORKSPACE, userIds: ["usr_jonas"] })
    ).resolves.toBe(0);

    expect(mock.abfragen).toHaveLength(1);
    expect(mock.sendNotification).not.toHaveBeenCalled();
  });

  it("lässt den Auslöser weiterhin aus", async () => {
    mock.abos = [abo("sub_dario", "usr_dario"), abo("sub_mia", "usr_mia")];

    await expect(
      sendPush(NACHRICHT, { workspaceId: WORKSPACE, excludeUserId: "usr_dario" })
    ).resolves.toBe(1);

    expect(mock.sendNotification).toHaveBeenCalledTimes(1);
    expect(mock.sendNotification.mock.calls[0][0]).toMatchObject({
      endpoint: "https://push.example/sub_mia",
    });
  });
});
