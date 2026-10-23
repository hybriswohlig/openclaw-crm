import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apiKeys,
  calendarFeedTokens,
  pushSubscriptions,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";

// „Mitglied entfernen“ löschte nur die Mitgliedschaft. getAuthContext legte
// freigegebene Benutzer bei der nächsten Anfrage wieder als Mitglied an, der
// Zugang blieb also. Diese Tests prüfen gegen eine aufzeichnende Fake-
// Transaktion, dass removeMember und rejectUser den Zugang wirklich entziehen
// (auch die Push-Abos: Pushes zeigen Kundennamen) und dass dabei jeder
// Workspace einen Admin und das CRM einen App-Admin behält. Das gilt beim
// Entfernen, beim Ablehnen unter Benutzer-Freigaben und beim Herabstufen
// (updateMemberRole); entschieden wird erst nach dem Sperren der Admin-Zeilen
// (FOR UPDATE), sich selbst entfernen geht ohnehin nicht.
// Gesperrte Konten lassen sich unter Benutzer-Freigaben wieder freigeben
// (listRejectedUsers, approveUser); nach der nächsten Anmeldung legt
// ensureUserWorkspaceAccess die Mitgliedschaft wieder an. Dazu updateWorkspace:
// Der Client bekommt die Einstellungen ohne OpenRouter-Schlüssel und darf ihn
// beim Zurückschreiben nicht löschen.
const mock = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/db", () => ({ db: mock }));

import {
  approveUser,
  ensureUserWorkspaceAccess,
  LetzterAdminError,
  listRejectedUsers,
  rejectUser,
  removeMember,
  revokeUserAccess,
  updateMemberRole,
  updateWorkspace,
} from "./workspace";

const dialect = new PgDialect();
function alsSql(bedingung: SQL) {
  const { sql, params } = dialect.sqlToQuery(bedingung);
  return { sql, params };
}

type Schreibvorgang =
  | { art: "update"; tabelle: unknown; werte: Record<string, unknown>; bedingung: SQL }
  | { art: "delete"; tabelle: unknown; bedingung: SQL };

/**
 * Fake-Transaktion (oder Fake-db): liefert die Lese-Antworten der Reihe nach
 * und zeichnet alle Schreibvorgänge auf.
 */
function fakeTx(leseAntworten: unknown[][]) {
  const schreibvorgaenge: Schreibvorgang[] = [];
  const eingefuegt: Array<{ tabelle: unknown; werte: Record<string, unknown> }> = [];
  const lesebedingungen: SQL[] = [];
  const sperren: string[] = [];
  let leseNr = 0;
  const tx = {
    select: () => ({
      from: () => {
        const zeilen = leseAntworten[leseNr++] ?? [];
        // Verkettbar wie bei Drizzle (where, orderBy, limit, for); await liefert die Zeilen.
        const abfrage = {
          where: (bedingung: SQL) => {
            lesebedingungen.push(bedingung);
            return abfrage;
          },
          orderBy: () => abfrage,
          limit: () => abfrage,
          for: (staerke: string) => {
            sperren.push(staerke);
            return abfrage;
          },
          then: <T>(weiter: (z: unknown[]) => T) => Promise.resolve(zeilen).then(weiter),
        };
        return abfrage;
      },
    }),
    update: (tabelle: unknown) => ({
      set: (werte: Record<string, unknown>) => ({
        where: (bedingung: SQL) => {
          schreibvorgaenge.push({ art: "update", tabelle, werte, bedingung });
          return Object.assign(Promise.resolve(), {
            returning: async () => [{ id: "ws_zeile", ...werte }],
          });
        },
      }),
    }),
    delete: (tabelle: unknown) => ({
      where: async (bedingung: SQL) => {
        schreibvorgaenge.push({ art: "delete", tabelle, bedingung });
      },
    }),
    insert: (tabelle: unknown) => ({
      values: async (werte: Record<string, unknown>) => {
        eingefuegt.push({ tabelle, werte });
      },
    }),
  };
  return { tx, schreibvorgaenge, eingefuegt, lesebedingungen, sperren };
}

function mitTransaktion(tx: unknown) {
  mock.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
}

/** Für Funktionen, die ohne Transaktion direkt über db lesen und schreiben. */
function alsDb({ tx }: ReturnType<typeof fakeTx>) {
  mock.select.mockImplementation(tx.select);
  mock.update.mockImplementation(tx.update);
  mock.insert.mockImplementation(tx.insert);
}

const WORKSPACE = "ws_kottke";
const AKTEUR = "usr_admin";

function mitglied(over: Partial<{ id: string; userId: string; role: "admin" | "member" }> = {}) {
  return {
    id: "mem_jonas",
    workspaceId: WORKSPACE,
    userId: "usr_jonas",
    role: "member" as const,
    permissions: {},
    createdAt: new Date("2026-01-01T09:00:00Z"),
    ...over,
  };
}

/** Prüft, dass genau dieser Benutzer gesperrt wurde, und nur er. */
function erwarteZugangEntzogen(schreibvorgaenge: Schreibvorgang[], userId: string) {
  expect(schreibvorgaenge).toHaveLength(6);

  const freigabe = schreibvorgaenge.find((s) => s.tabelle === users);
  expect(freigabe?.art).toBe("update");
  expect(freigabe?.art === "update" && freigabe.werte).toMatchObject({
    approvalStatus: "rejected",
    updatedAt: expect.any(Date),
  });
  expect(alsSql(freigabe!.bedingung)).toEqual({
    sql: '"users"."id" = $1',
    params: [userId],
  });

  const sitzungen = schreibvorgaenge.find((s) => s.tabelle === sessions);
  expect(sitzungen?.art).toBe("delete");
  expect(alsSql(sitzungen!.bedingung)).toEqual({
    sql: '"sessions"."user_id" = $1',
    params: [userId],
  });

  const schluessel = schreibvorgaenge.find((s) => s.tabelle === apiKeys);
  expect(schluessel?.art).toBe("update");
  expect(schluessel?.art === "update" && schluessel.werte).toEqual({
    revokedAt: expect.any(Date),
  });
  // Nur die eigenen, noch offenen Schlüssel: ein bereits gesetztes revoked_at
  // bleibt unverändert, fremde Schlüssel bleiben unberührt.
  expect(alsSql(schluessel!.bedingung)).toEqual({
    sql: '("api_keys"."user_id" = $1 and "api_keys"."revoked_at" is null)',
    params: [userId],
  });

  // Seine Geräte bekommen keine Pushes mehr (Kundennamen, Nachrichtenvorschau).
  const pushAbos = schreibvorgaenge.find((s) => s.tabelle === pushSubscriptions);
  expect(pushAbos?.art).toBe("delete");
  expect(alsSql(pushAbos!.bedingung)).toEqual({
    sql: '"push_subscriptions"."user_id" = $1',
    params: [userId],
  });

  // Der Kalender-Feed zeigt Kundenadressen; offene Feed-Links werden gesperrt.
  const feeds = schreibvorgaenge.find((s) => s.tabelle === calendarFeedTokens);
  expect(feeds?.art).toBe("update");
  expect(feeds?.art === "update" && feeds.werte).toEqual({ revokedAt: expect.any(Date) });
  expect(alsSql(feeds!.bedingung)).toEqual({
    sql: '("calendar_feed_tokens"."user_id" = $1 and "calendar_feed_tokens"."revoked_at" is null)',
    params: [userId],
  });

  const mitgliedschaften = schreibvorgaenge.find((s) => s.tabelle === workspaceMembers);
  expect(mitgliedschaften?.art).toBe("delete");
  expect(alsSql(mitgliedschaften!.bedingung)).toEqual({
    sql: '"workspace_members"."user_id" = $1',
    params: [userId],
  });
}

// Abfragen der Admin-Prüfung in revokeUserAccess (pruefeAdminsBleiben).
const MITGLIEDSCHAFTEN_VON = (userId: string) => ({
  sql: '"workspace_members"."user_id" = $1',
  params: [userId],
});
const ADMIN_ZEILEN = {
  sql: '("workspace_members"."workspace_id" = $1 and "workspace_members"."role" = $2)',
  params: [WORKSPACE, "admin"],
};
const KONTO_VON = (userId: string) => ({ sql: '"users"."id" = $1', params: [userId] });
const APP_ADMIN_ZEILEN = {
  sql: '("users"."is_app_admin" = $1 and "users"."approval_status" = $2)',
  params: [true, "approved"],
};

/**
 * Lese-Antworten der Admin-Prüfung in revokeUserAccess, in Abfragereihenfolge:
 * Workspaces des Benutzers (hier nur WORKSPACE), dessen gesperrte Admins, das
 * Konto und, nur bei App-Admins, die gesperrten freigegebenen App-Admins.
 */
function adminPruefung({
  admins,
  appAdmin = false,
  appAdmins = [],
}: {
  /** Benutzer-IDs der Admins in WORKSPACE */
  admins: string[];
  /** Ist der Betroffene selbst App-Admin? */
  appAdmin?: boolean;
  /** Benutzer-IDs der freigegebenen App-Admins */
  appAdmins?: string[];
}): unknown[][] {
  return [
    [{ workspaceId: WORKSPACE }],
    admins.map((userId) => ({ id: userId.replace("usr_", "mem_"), userId })),
    [{ isAppAdmin: appAdmin }],
    ...(appAdmin ? [appAdmins.map((id) => ({ id }))] : []),
  ];
}

/** Erwartet die Ablehnung „letzter Admin“ mit genau diesem Text; die Routen machen 409 daraus. */
async function erwarteLetzterAdmin(aufruf: Promise<unknown>, text: string) {
  const fehler = await aufruf.then(
    () => null,
    (e: unknown) => e
  );
  expect(fehler).toBeInstanceOf(LetzterAdminError);
  expect((fehler as Error).message).toBe(text);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("removeMember", () => {
  it("entzieht einem Mitglied den Zugang ganz: Freigabe, Sitzungen, API-Schlüssel, Push-Abos, Mitgliedschaft", async () => {
    const zeile = mitglied();
    const { tx, schreibvorgaenge, lesebedingungen } = fakeTx([
      [zeile],
      ...adminPruefung({ admins: [AKTEUR] }),
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).resolves.toEqual(zeile);

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    // Die Mitgliedschaft wird nur im eigenen Workspace gesucht.
    expect(alsSql(lesebedingungen[0])).toEqual({
      sql: '("workspace_members"."id" = $1 and "workspace_members"."workspace_id" = $2)',
      params: ["mem_jonas", WORKSPACE],
    });
    erwarteZugangEntzogen(schreibvorgaenge, "usr_jonas");
  });

  it("lehnt es ab, sich selbst zu entfernen, und schreibt nichts", async () => {
    const { tx, schreibvorgaenge } = fakeTx([[mitglied({ userId: AKTEUR, role: "admin" })]]);
    mitTransaktion(tx);

    const fehler = await removeMember(WORKSPACE, "mem_jonas", AKTEUR).catch((e: unknown) => e);

    // Kein „letzter Admin“: Die Route antwortet hier mit 400, nicht mit 409.
    expect(fehler).toBeInstanceOf(Error);
    expect(fehler).not.toBeInstanceOf(LetzterAdminError);
    expect((fehler as Error).message).toBe("Du kannst dich nicht selbst entfernen.");
    expect(schreibvorgaenge).toEqual([]);
  });

  it("lehnt es ab, den letzten Admin zu entfernen, und schreibt nichts", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [mitglied({ role: "admin" })],
      ...adminPruefung({ admins: ["usr_jonas"] }),
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      removeMember(WORKSPACE, "mem_jonas", AKTEUR),
      "Der letzte Admin kann nicht entfernt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    expect(sperren).toEqual(["update"]);
  });

  it("entfernt einen Admin, solange ein weiterer Admin bleibt, und sperrt dabei die Admin-Zeilen", async () => {
    const zeile = mitglied({ role: "admin" });
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [zeile],
      ...adminPruefung({ admins: ["usr_jonas", AKTEUR] }),
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).resolves.toEqual(zeile);

    // Erst die Workspaces des Benutzers, dann deren Admin-Zeilen (FOR UPDATE).
    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[1])).toEqual(MITGLIEDSCHAFTEN_VON("usr_jonas"));
    expect(alsSql(lesebedingungen[2])).toEqual(ADMIN_ZEILEN);
    erwarteZugangEntzogen(schreibvorgaenge, "usr_jonas");
  });

  it("entscheidet nach den gesperrten Admin-Zeilen, nicht nach der Lesung davor", async () => {
    // Gelesen als Mitglied. Bis die Admin-Zeilen gesperrt sind, ist Jonas
    // Admin geworden und der andere Admin zum Mitglied gemacht: Jetzt ist er
    // der letzte Admin und darf nicht gehen.
    const { tx, schreibvorgaenge } = fakeTx([
      [mitglied({ role: "member" })],
      ...adminPruefung({ admins: ["usr_jonas"] }),
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      removeMember(WORKSPACE, "mem_jonas", AKTEUR),
      "Der letzte Admin kann nicht entfernt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
  });

  it("sperrt bei einem Mitglied ohne Freigaberecht die Admin-Zeilen, aber keine Konten", async () => {
    const { tx, lesebedingungen, sperren } = fakeTx([
      [mitglied()],
      ...adminPruefung({ admins: [AKTEUR] }),
    ]);
    mitTransaktion(tx);

    await removeMember(WORKSPACE, "mem_jonas", AKTEUR);

    // Das Konto wird nur gelesen; App-Admins zählt nur, wer selbst einer ist.
    expect(sperren).toEqual(["update"]);
    expect(lesebedingungen).toHaveLength(4);
    expect(alsSql(lesebedingungen[3])).toEqual(KONTO_VON("usr_jonas"));
  });

  it("lehnt es ab, den letzten Admin für Benutzer-Freigaben zu entfernen, und schreibt nichts", async () => {
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [mitglied()],
      ...adminPruefung({ admins: [AKTEUR], appAdmin: true, appAdmins: ["usr_jonas"] }),
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      removeMember(WORKSPACE, "mem_jonas", AKTEUR),
      "Der letzte Admin für Benutzer-Freigaben kann nicht entfernt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    // Gezählt werden nur freigegebene App-Admins, ihre Konten gesperrt (FOR UPDATE).
    expect(sperren).toEqual(["update", "update"]);
    expect(alsSql(lesebedingungen[4])).toEqual(APP_ADMIN_ZEILEN);
  });

  it("entfernt einen App-Admin, solange ein weiterer freigegebener App-Admin bleibt", async () => {
    const zeile = mitglied();
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [zeile],
      ...adminPruefung({ admins: [AKTEUR], appAdmin: true, appAdmins: ["usr_jonas", AKTEUR] }),
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).resolves.toEqual(zeile);

    expect(sperren).toEqual(["update", "update"]);
    erwarteZugangEntzogen(schreibvorgaenge, "usr_jonas");
  });

  it("prüft bei einem Admin, der auch Konten freigibt, beide Regeln", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [mitglied({ role: "admin" })],
      ...adminPruefung({
        admins: ["usr_jonas", AKTEUR],
        appAdmin: true,
        appAdmins: ["usr_jonas"],
      }),
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      removeMember(WORKSPACE, "mem_jonas", AKTEUR),
      "Der letzte Admin für Benutzer-Freigaben kann nicht entfernt werden."
    );
    expect(sperren).toEqual(["update", "update"]);
    expect(schreibvorgaenge).toEqual([]);
  });

  it("gibt null zurück, wenn es die Mitgliedschaft in diesem Workspace nicht gibt", async () => {
    const { tx, schreibvorgaenge } = fakeTx([[]]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_fremd", AKTEUR)).resolves.toBeNull();
    expect(schreibvorgaenge).toEqual([]);
  });
});

describe("updateMemberRole", () => {
  it("macht einen Admin zum Mitglied, solange ein weiterer Admin bleibt", async () => {
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [{ id: "mem_jonas" }],
      [
        { id: "mem_jonas", userId: "usr_jonas" },
        { id: "mem_admin", userId: AKTEUR },
      ],
    ]);
    mitTransaktion(tx);

    await expect(updateMemberRole(WORKSPACE, "mem_jonas", "member")).resolves.toMatchObject({
      role: "member",
    });

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(alsSql(lesebedingungen[0])).toEqual({
      sql: '("workspace_members"."id" = $1 and "workspace_members"."workspace_id" = $2)',
      params: ["mem_jonas", WORKSPACE],
    });
    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[1])).toEqual(ADMIN_ZEILEN);
    expect(schreibvorgaenge).toHaveLength(1);
    const [schreiben] = schreibvorgaenge;
    expect(schreiben.tabelle).toBe(workspaceMembers);
    expect(schreiben.art === "update" && schreiben.werte).toEqual({ role: "member" });
    expect(schreiben.art === "update" && alsSql(schreiben.bedingung)).toEqual({
      sql: '("workspace_members"."id" = $1 and "workspace_members"."workspace_id" = $2)',
      params: ["mem_jonas", WORKSPACE],
    });
  });

  it("lehnt es ab, den letzten Admin zum Mitglied zu machen, und schreibt nichts", async () => {
    // Entscheidend sind die gesperrten Admin-Zeilen: Jonas ist der einzige.
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [{ id: "mem_jonas" }],
      [{ id: "mem_jonas", userId: "usr_jonas" }],
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      updateMemberRole(WORKSPACE, "mem_jonas", "member"),
      "Der letzte Admin kann nicht zum Mitglied gemacht werden."
    );
    expect(sperren).toEqual(["update"]);
    expect(schreibvorgaenge).toEqual([]);
  });

  it("lässt ein Mitglied, das kein Admin ist, Mitglied sein, sperrt aber vorher", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [{ id: "mem_jonas" }],
      [{ id: "mem_admin", userId: AKTEUR }],
    ]);
    mitTransaktion(tx);

    await expect(updateMemberRole(WORKSPACE, "mem_jonas", "member")).resolves.toMatchObject({
      role: "member",
    });
    // Ob Jonas Admin ist, sagen erst die gesperrten Zeilen.
    expect(sperren).toEqual(["update"]);
    expect(schreibvorgaenge).toHaveLength(1);
  });

  it("sperrt nichts, wenn jemand Admin wird", async () => {
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([[{ id: "mem_jonas" }]]);
    mitTransaktion(tx);

    await expect(updateMemberRole(WORKSPACE, "mem_jonas", "admin")).resolves.toMatchObject({
      role: "admin",
    });

    expect(lesebedingungen).toHaveLength(1);
    expect(sperren).toEqual([]);
    expect(schreibvorgaenge).toHaveLength(1);
  });

  it("gibt null zurück, wenn es die Mitgliedschaft in diesem Workspace nicht gibt", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([[]]);
    mitTransaktion(tx);

    await expect(updateMemberRole(WORKSPACE, "mem_fremd", "member")).resolves.toBeNull();
    expect(schreibvorgaenge).toEqual([]);
    expect(sperren).toEqual([]);
  });
});

describe("rejectUser", () => {
  const jetzt = new Date("2026-10-08T21:00:00Z");

  it("nimmt dem Konto in einer Transaktion den Zugang ganz", async () => {
    const { tx, schreibvorgaenge, lesebedingungen } = fakeTx([
      [{ id: "usr_jonas" }],
      ...adminPruefung({ admins: [AKTEUR] }),
    ]);
    mitTransaktion(tx);

    await expect(rejectUser("usr_jonas", jetzt)).resolves.toEqual({
      id: "usr_jonas",
      approvalStatus: "rejected",
    });

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(alsSql(lesebedingungen[0])).toEqual(KONTO_VON("usr_jonas"));
    erwarteZugangEntzogen(schreibvorgaenge, "usr_jonas");
    const freigabe = schreibvorgaenge.find((s) => s.tabelle === users);
    expect(freigabe?.art === "update" && freigabe.werte.updatedAt).toBe(jetzt);
  });

  it("lehnt den einzigen Admin des Teams nicht ab, auch nicht für einen App-Admin, der dort nur Mitglied ist", async () => {
    // Ablehnen darf jeder App-Admin, egal welche Rolle er im Team hat. Jonas
    // ist der einzige Admin des Workspace.
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [{ id: "usr_jonas" }],
      ...adminPruefung({ admins: ["usr_jonas"] }),
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      rejectUser("usr_jonas", jetzt),
      "Der letzte Admin kann nicht abgelehnt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    // In derselben Transaktion, mit gesperrten Admin-Zeilen.
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[1])).toEqual(MITGLIEDSCHAFTEN_VON("usr_jonas"));
    expect(alsSql(lesebedingungen[2])).toEqual(ADMIN_ZEILEN);
  });

  it("lehnt den letzten freigegebenen App-Admin nicht ab", async () => {
    // App-Admin ohne Mitgliedschaft, etwa vor seiner ersten Anmeldung im CRM.
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [{ id: "usr_jonas" }],
      [],
      [{ isAppAdmin: true }],
      [{ id: "usr_jonas" }],
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      rejectUser("usr_jonas", jetzt),
      "Der letzte Admin für Benutzer-Freigaben kann nicht abgelehnt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[3])).toEqual(APP_ADMIN_ZEILEN);
  });

  it("prüft jeden Workspace, in dem das Konto Mitglied ist", async () => {
    // revokeUserAccess löscht alle Mitgliedschaften. Im zweiten Workspace ist
    // Jonas der einzige Admin.
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [{ id: "usr_jonas" }],
      [{ workspaceId: WORKSPACE }, { workspaceId: "ws_zweit" }],
      [
        { id: "mem_jonas", userId: "usr_jonas" },
        { id: "mem_admin", userId: AKTEUR },
      ],
      [{ id: "mem_jonas_zweit", userId: "usr_jonas" }],
    ]);
    mitTransaktion(tx);

    await erwarteLetzterAdmin(
      rejectUser("usr_jonas", jetzt),
      "Der letzte Admin kann nicht abgelehnt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    expect(sperren).toEqual(["update", "update"]);
    expect(alsSql(lesebedingungen[3])).toEqual({
      sql: ADMIN_ZEILEN.sql,
      params: ["ws_zweit", "admin"],
    });
  });

  it("gibt null zurück, wenn es das Konto nicht gibt", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([[]]);
    mitTransaktion(tx);

    await expect(rejectUser("usr_fremd", jetzt)).resolves.toBeNull();
    expect(schreibvorgaenge).toEqual([]);
    expect(sperren).toEqual([]);
  });
});

describe("listRejectedUsers", () => {
  it("liefert gesperrte CRM-Konten, ohne Konten fürs Mitarbeiterportal", async () => {
    const gesperrt = [{ id: "usr_jonas", name: "Jonas", email: "jonas@kottke-umzuege.de" }];
    const fake = fakeTx([gesperrt]);
    alsDb(fake);

    await expect(listRejectedUsers()).resolves.toEqual(gesperrt);

    expect(alsSql(fake.lesebedingungen[0])).toEqual({
      sql: '("users"."approval_status" = $1 and "users"."role" <> $2)',
      params: ["rejected", "employee"],
    });
  });
});

describe("approveUser", () => {
  const jetzt = new Date("2026-10-08T19:00:00Z");

  it.each(["rejected", "pending"])("gibt ein Konto mit Freigabe „%s“ frei", async (vorher) => {
    const fake = fakeTx([[{ approvalStatus: vorher }]]);
    alsDb(fake);

    await expect(approveUser("usr_jonas", jetzt)).resolves.toEqual({
      id: "usr_jonas",
      approvalStatus: "approved",
    });

    expect(alsSql(fake.lesebedingungen[0])).toEqual({ sql: '"users"."id" = $1', params: ["usr_jonas"] });
    expect(fake.schreibvorgaenge).toHaveLength(1);
    const [schreiben] = fake.schreibvorgaenge;
    expect(schreiben.tabelle).toBe(users);
    expect(schreiben.art === "update" && schreiben.werte).toEqual({
      approvalStatus: "approved",
      updatedAt: jetzt,
    });
    expect(schreiben.art === "update" && alsSql(schreiben.bedingung)).toEqual({
      sql: '"users"."id" = $1',
      params: ["usr_jonas"],
    });
  });

  it("lässt ein freigegebenes Konto unverändert", async () => {
    const fake = fakeTx([[{ approvalStatus: "approved" }]]);
    alsDb(fake);

    await expect(approveUser("usr_jonas", jetzt)).resolves.toEqual({
      id: "usr_jonas",
      approvalStatus: "approved",
    });
    expect(fake.schreibvorgaenge).toEqual([]);
  });

  it("gibt null zurück, wenn es das Konto nicht gibt", async () => {
    const fake = fakeTx([[]]);
    alsDb(fake);

    await expect(approveUser("usr_fremd", jetzt)).resolves.toBeNull();
    expect(fake.schreibvorgaenge).toEqual([]);
  });
});

describe("ensureUserWorkspaceAccess nach „Wieder freigeben“", () => {
  // Entfernen löscht die Mitgliedschaft. Ist das Konto wieder freigegeben,
  // legt der erste Aufruf nach der Anmeldung (getAuthContext) sie neu an.
  it("legt die Mitgliedschaft neu an, als Mitglied", async () => {
    const fake = fakeTx([[{ id: WORKSPACE }], [], [{ count: 3 }]]);
    alsDb(fake);

    await expect(ensureUserWorkspaceAccess("usr_jonas", false)).resolves.toEqual({
      workspaceId: WORKSPACE,
      role: "member",
      permissions: {},
    });

    expect(fake.schreibvorgaenge).toEqual([]);
    expect(fake.eingefuegt).toEqual([
      { tabelle: workspaceMembers, werte: { workspaceId: WORKSPACE, userId: "usr_jonas", role: "member" } },
    ]);
  });

  it("App-Admins kommen als Admin zurück", async () => {
    const fake = fakeTx([[{ id: WORKSPACE }], [], [{ count: 3 }]]);
    alsDb(fake);

    await expect(ensureUserWorkspaceAccess("usr_jonas", true)).resolves.toMatchObject({ role: "admin" });
    expect(fake.eingefuegt).toEqual([
      { tabelle: workspaceMembers, werte: { workspaceId: WORKSPACE, userId: "usr_jonas", role: "admin" } },
    ]);
  });
});

describe("revokeUserAccess", () => {
  const alsTx = (tx: unknown) => tx as Parameters<typeof revokeUserAccess>[0];

  it("setzt Freigabe und Sperrzeitpunkt auf den übergebenen Zeitpunkt", async () => {
    const { tx, schreibvorgaenge } = fakeTx(adminPruefung({ admins: [AKTEUR] }));
    const jetzt = new Date("2026-10-08T18:30:00Z");

    await revokeUserAccess(alsTx(tx), "usr_mia", "entfernt", jetzt);

    erwarteZugangEntzogen(schreibvorgaenge, "usr_mia");
    const freigabe = schreibvorgaenge.find((s) => s.tabelle === users);
    const schluessel = schreibvorgaenge.find((s) => s.tabelle === apiKeys);
    expect(freigabe?.art === "update" && freigabe.werte.updatedAt).toBe(jetzt);
    expect(schluessel?.art === "update" && schluessel.werte.revokedAt).toBe(jetzt);
  });

  it("löscht auch alle Push-Abos des Benutzers, über die übergebene Transaktion", async () => {
    const { tx, schreibvorgaenge } = fakeTx(adminPruefung({ admins: [AKTEUR] }));

    await revokeUserAccess(alsTx(tx), "usr_mia", "entfernt");

    // Sonst kämen auf seinen Geräten weiter Kundennamen und Vorschauen an. Die
    // Fake-db kann gar nicht löschen: Der Eintrag stammt aus der Transaktion.
    const pushAbos = schreibvorgaenge.filter((s) => s.tabelle === pushSubscriptions);
    expect(pushAbos).toHaveLength(1);
    expect(pushAbos[0].art).toBe("delete");
    expect(alsSql(pushAbos[0].bedingung)).toEqual({
      sql: '"push_subscriptions"."user_id" = $1',
      params: ["usr_mia"],
    });
  });

  it("prüft die Admin-Regeln selbst, bevor sie etwas schreibt", async () => {
    // Die Route „Ablehnen“ rief revokeUserAccess ohne diese Prüfung auf. Jetzt
    // steckt sie hier drin, kein Aufrufer kann sie vergessen.
    const { tx, schreibvorgaenge, sperren } = fakeTx(adminPruefung({ admins: ["usr_mia"] }));

    await erwarteLetzterAdmin(
      revokeUserAccess(alsTx(tx), "usr_mia", "abgelehnt"),
      "Der letzte Admin kann nicht abgelehnt werden."
    );
    expect(sperren).toEqual(["update"]);
    expect(schreibvorgaenge).toEqual([]);
  });
});

describe("updateWorkspace", () => {
  const SCHLUESSEL = "sk-or-v1-geheim-1234567890";
  const gespeichert = {
    logo: "<svg>alt</svg>",
    openrouterApiKey: SCHLUESSEL,
    openrouterModel: "anthropic/claude-sonnet-4",
  };

  it("behält den OpenRouter-Schlüssel, wenn die allgemeinen Einstellungen gespeichert werden", async () => {
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([[{ settings: gespeichert }]]);
    mitTransaktion(tx);

    // So schickt es die Seite „Allgemein“: { ...settings, logo } mit den
    // Einstellungen aus GET /api/v1/workspace, also ohne Schlüssel.
    const ergebnis = await updateWorkspace(WORKSPACE, {
      name: "Kottke Umzüge",
      settings: { logo: "<svg>neu</svg>", openrouterModel: "anthropic/claude-sonnet-4" },
    });

    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[0])).toEqual({
      sql: '"workspaces"."id" = $1',
      params: [WORKSPACE],
    });
    expect(schreibvorgaenge).toHaveLength(1);
    const [schreiben] = schreibvorgaenge;
    expect(schreiben.tabelle).toBe(workspaces);
    expect(schreiben.art === "update" && schreiben.werte).toEqual({
      name: "Kottke Umzüge",
      settings: {
        logo: "<svg>neu</svg>",
        openrouterApiKey: SCHLUESSEL,
        openrouterModel: "anthropic/claude-sonnet-4",
      },
      updatedAt: expect.any(Date),
    });
    expect(alsSql(schreiben.bedingung)).toEqual({
      sql: '"workspaces"."id" = $1',
      params: [WORKSPACE],
    });
    expect(ergebnis).toMatchObject({ name: "Kottke Umzüge" });
  });

  it("liest bei einer reinen Namensänderung nichts und lässt die Einstellungen stehen", async () => {
    const { tx, schreibvorgaenge, lesebedingungen } = fakeTx([]);
    mitTransaktion(tx);

    await updateWorkspace(WORKSPACE, { name: "Kottke Umzüge GmbH" });

    expect(lesebedingungen).toEqual([]);
    expect(schreibvorgaenge).toHaveLength(1);
    expect(schreibvorgaenge[0].art === "update" && schreibvorgaenge[0].werte).toEqual({
      name: "Kottke Umzüge GmbH",
      updatedAt: expect.any(Date),
    });
  });
});
