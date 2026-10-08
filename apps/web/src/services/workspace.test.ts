import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { apiKeys, sessions, users, workspaceMembers, workspaces } from "@/db/schema";

// „Mitglied entfernen“ löschte nur die Mitgliedschaft. getAuthContext legte
// freigegebene Benutzer bei der nächsten Anfrage wieder als Mitglied an, der
// Zugang blieb also. Diese Tests prüfen gegen eine aufzeichnende Fake-
// Transaktion, dass removeMember den Zugang wirklich entzieht und die Sperren
// für die eigene Person, den letzten Admin und den letzten App-Admin greifen.
// Den letzten Admin zum Mitglied machen darf auch updateMemberRole nicht.
// Dazu updateWorkspace: Der Client bekommt die Einstellungen ohne
// OpenRouter-Schlüssel und darf ihn beim Zurückschreiben nicht löschen.
const mock = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mock.transaction } }));

import { removeMember, revokeUserAccess, updateMemberRole, updateWorkspace } from "./workspace";

const dialect = new PgDialect();
function alsSql(bedingung: SQL) {
  const { sql, params } = dialect.sqlToQuery(bedingung);
  return { sql, params };
}

type Schreibvorgang =
  | { art: "update"; tabelle: unknown; werte: Record<string, unknown>; bedingung: SQL }
  | { art: "delete"; tabelle: unknown; bedingung: SQL };

/** Fake-Transaktion: liefert die Lese-Antworten der Reihe nach und zeichnet alle Schreibvorgänge auf. */
function fakeTx(leseAntworten: unknown[][]) {
  const schreibvorgaenge: Schreibvorgang[] = [];
  const lesebedingungen: SQL[] = [];
  const sperren: string[] = [];
  let leseNr = 0;
  const tx = {
    select: () => ({
      from: () => ({
        where: (bedingung: SQL) => {
          lesebedingungen.push(bedingung);
          const zeilen = leseAntworten[leseNr++] ?? [];
          return {
            limit: async () => zeilen,
            for: async (staerke: string) => {
              sperren.push(staerke);
              return zeilen;
            },
          };
        },
      }),
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
  };
  return { tx, schreibvorgaenge, lesebedingungen, sperren };
}

function mitTransaktion(tx: unknown) {
  mock.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
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
  expect(schreibvorgaenge).toHaveLength(4);

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

  const mitgliedschaften = schreibvorgaenge.find((s) => s.tabelle === workspaceMembers);
  expect(mitgliedschaften?.art).toBe("delete");
  expect(alsSql(mitgliedschaften!.bedingung)).toEqual({
    sql: '"workspace_members"."user_id" = $1',
    params: [userId],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("removeMember", () => {
  it("entzieht einem Mitglied den Zugang ganz: Freigabe, Sitzungen, API-Schlüssel, Mitgliedschaft", async () => {
    const zeile = mitglied();
    const { tx, schreibvorgaenge, lesebedingungen } = fakeTx([[zeile]]);
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

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).rejects.toThrow(
      "Du kannst dich nicht selbst entfernen."
    );
    expect(schreibvorgaenge).toEqual([]);
  });

  it("lehnt es ab, den letzten Admin zu entfernen, und schreibt nichts", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [mitglied({ role: "admin" })],
      [{ id: "mem_jonas" }],
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).rejects.toThrow(
      "Der letzte Admin kann nicht entfernt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    expect(sperren).toEqual(["update"]);
  });

  it("entfernt einen Admin, solange ein weiterer Admin bleibt, und sperrt dabei die Admin-Zeilen", async () => {
    const zeile = mitglied({ role: "admin" });
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [zeile],
      [{ id: "mem_jonas" }, { id: "mem_dario" }],
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).resolves.toEqual(zeile);

    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[1])).toEqual({
      sql: '("workspace_members"."workspace_id" = $1 and "workspace_members"."role" = $2)',
      params: [WORKSPACE, "admin"],
    });
    erwarteZugangEntzogen(schreibvorgaenge, "usr_jonas");
  });

  it("zählt bei einem normalen Mitglied ohne Freigaberecht keine Admins", async () => {
    const { tx, lesebedingungen, sperren } = fakeTx([[mitglied()], [{ isAppAdmin: false }]]);
    mitTransaktion(tx);

    await removeMember(WORKSPACE, "mem_jonas", AKTEUR);

    // Gelesen werden nur die Mitgliedschaft und das Konto, gesperrt wird nichts.
    expect(lesebedingungen).toHaveLength(2);
    expect(alsSql(lesebedingungen[1])).toEqual({
      sql: '"users"."id" = $1',
      params: ["usr_jonas"],
    });
    expect(sperren).toEqual([]);
  });

  it("lehnt es ab, den letzten Admin für Benutzer-Freigaben zu entfernen, und schreibt nichts", async () => {
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [mitglied()],
      [{ isAppAdmin: true }],
      [{ id: "usr_jonas" }],
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).rejects.toThrow(
      "Der letzte Admin für Benutzer-Freigaben kann nicht entfernt werden."
    );
    expect(schreibvorgaenge).toEqual([]);
    // Gezählt werden nur freigegebene App-Admins, ihre Konten gesperrt (FOR UPDATE).
    expect(sperren).toEqual(["update"]);
    expect(alsSql(lesebedingungen[2])).toEqual({
      sql: '("users"."is_app_admin" = $1 and "users"."approval_status" = $2)',
      params: [true, "approved"],
    });
  });

  it("entfernt einen App-Admin, solange ein weiterer freigegebener App-Admin bleibt", async () => {
    const zeile = mitglied();
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [zeile],
      [{ isAppAdmin: true }],
      [{ id: "usr_jonas" }, { id: AKTEUR }],
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).resolves.toEqual(zeile);

    expect(sperren).toEqual(["update"]);
    erwarteZugangEntzogen(schreibvorgaenge, "usr_jonas");
  });

  it("prüft bei einem Admin, der auch Konten freigibt, beide Regeln", async () => {
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [mitglied({ role: "admin" })],
      [{ id: "mem_jonas" }, { id: "mem_dario" }],
      [{ isAppAdmin: true }],
      [{ id: "usr_jonas" }],
    ]);
    mitTransaktion(tx);

    await expect(removeMember(WORKSPACE, "mem_jonas", AKTEUR)).rejects.toThrow(
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
  const ROLLE_SQL = {
    sql: '("workspace_members"."workspace_id" = $1 and "workspace_members"."role" = $2)',
    params: [WORKSPACE, "admin"],
  };

  it("macht einen Admin zum Mitglied, solange ein weiterer Admin bleibt", async () => {
    const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([
      [{ id: "mem_jonas", role: "admin" }],
      [{ id: "mem_jonas" }, { id: "mem_dario" }],
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
    expect(alsSql(lesebedingungen[1])).toEqual(ROLLE_SQL);
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
    const { tx, schreibvorgaenge, sperren } = fakeTx([
      [{ id: "mem_jonas", role: "admin" }],
      [{ id: "mem_jonas" }],
    ]);
    mitTransaktion(tx);

    await expect(updateMemberRole(WORKSPACE, "mem_jonas", "member")).rejects.toThrow(
      "Der letzte Admin kann nicht zum Mitglied gemacht werden."
    );
    expect(sperren).toEqual(["update"]);
    expect(schreibvorgaenge).toEqual([]);
  });

  it("zählt keine Admins, wenn niemand Admin verliert", async () => {
    for (const [vorher, nachher] of [
      ["member", "admin"],
      ["admin", "admin"],
      ["member", "member"],
    ] as const) {
      const { tx, schreibvorgaenge, lesebedingungen, sperren } = fakeTx([[{ id: "mem_jonas", role: vorher }]]);
      mitTransaktion(tx);

      await expect(updateMemberRole(WORKSPACE, "mem_jonas", nachher)).resolves.toMatchObject({ role: nachher });

      expect(lesebedingungen).toHaveLength(1);
      expect(sperren).toEqual([]);
      expect(schreibvorgaenge).toHaveLength(1);
    }
  });

  it("gibt null zurück, wenn es die Mitgliedschaft in diesem Workspace nicht gibt", async () => {
    const { tx, schreibvorgaenge } = fakeTx([[]]);
    mitTransaktion(tx);

    await expect(updateMemberRole(WORKSPACE, "mem_fremd", "member")).resolves.toBeNull();
    expect(schreibvorgaenge).toEqual([]);
  });
});

describe("revokeUserAccess", () => {
  it("setzt Freigabe und Sperrzeitpunkt auf den übergebenen Zeitpunkt", async () => {
    const { tx, schreibvorgaenge } = fakeTx([]);
    const jetzt = new Date("2026-10-08T18:30:00Z");

    await revokeUserAccess(tx as unknown as Parameters<typeof revokeUserAccess>[0], "usr_mia", jetzt);

    erwarteZugangEntzogen(schreibvorgaenge, "usr_mia");
    const freigabe = schreibvorgaenge.find((s) => s.tabelle === users);
    const schluessel = schreibvorgaenge.find((s) => s.tabelle === apiKeys);
    expect(freigabe?.art === "update" && freigabe.werte.updatedAt).toBe(jetzt);
    expect(schluessel?.art === "update" && schluessel.werte.revokedAt).toBe(jetzt);
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
