import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getUserSettings: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/user-settings", () => ({
  getUserSettings: mocks.getUserSettings,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.limit,
        }),
      }),
    }),
  },
}));

import { GET } from "./route";

const NUTZER = {
  userId: "usr_jonas",
  workspaceId: "ws_kottke",
  workspaceRole: "member" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function ziel(res: Response): URL {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("keine Location");
  return new URL(loc);
}

function cookie(res: Response): string | null {
  const zeile = res.headers.getSetCookie().find((z) => z.startsWith("crm_ui="));
  return zeile ? zeile.slice("crm_ui=".length).split(";", 1)[0] : null;
}

function anfrage(suche: string): NextRequest {
  return new NextRequest(`https://crm.test/weiter${suche}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(NUTZER);
  mocks.getUserSettings.mockResolvedValue({ uiVersion: "neu", ansichten: {} });
  mocks.limit.mockResolvedValue([]);
});

describe("GET /weiter", () => {
  it("leitet ohne Sitzung auf den Login und behält die Abfrage", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await GET(anfrage("?conv=c"));

    expect(res.status).toBe(307);
    const loc = ziel(res);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("redirect")).toBe("/weiter?conv=c");
    expect(cookie(res)).toBeNull();
    expect(mocks.getUserSettings).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("neu und Gespräch mit Deal öffnet den Deal-Eintrag", async () => {
    mocks.limit.mockResolvedValue([{ dealRecordId: "d1" }]);

    const res = await GET(anfrage("?conv=c1"));

    expect(res.status).toBe(307);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ziel(res).pathname + ziel(res).search).toBe("/app/inbox?e=deal%3Ad1");
    expect(cookie(res)).toBe("neu");
    expect(mocks.getUserSettings).toHaveBeenCalledWith("usr_jonas");
    expect(mocks.limit).toHaveBeenCalledOnce();
  });

  it("neu und Gespräch ohne Deal öffnet den Gesprächs-Eintrag", async () => {
    mocks.limit.mockResolvedValue([{ dealRecordId: null }]);

    const res = await GET(anfrage("?conv=c1"));

    expect(ziel(res).pathname + ziel(res).search).toBe("/app/inbox?e=gespraech%3Ac1");
    expect(cookie(res)).toBe("neu");
  });

  it("fremder Workspace (keine Zeile) gibt keinen Deal-Hinweis", async () => {
    mocks.limit.mockResolvedValue([]);

    const res = await GET(anfrage("?conv=c1"));

    expect(ziel(res).pathname + ziel(res).search).toBe("/app/inbox?e=gespraech%3Ac1");
    expect(cookie(res)).toBe("neu");
  });

  it("Lesefehler am Gespräch zählt wie kein Deal", async () => {
    mocks.limit.mockRejectedValue(new Error("db weg"));

    const res = await GET(anfrage("?conv=c1"));

    expect(res.status).toBe(307);
    expect(ziel(res).pathname + ziel(res).search).toBe("/app/inbox?e=gespraech%3Ac1");
    expect(cookie(res)).toBe("neu");
  });

  it("neu und Deal liest die Datenbank nicht", async () => {
    const res = await GET(anfrage("?deal=d1"));

    expect(ziel(res).pathname).toBe("/app/leads/d1");
    expect(cookie(res)).toBe("neu");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("alt hängt alt=1 an und setzt das Cookie", async () => {
    mocks.getUserSettings.mockResolvedValue({ uiVersion: "alt", ansichten: {} });

    const res = await GET(anfrage("?deal=d1"));

    expect(res.status).toBe(307);
    expect(ziel(res).pathname + ziel(res).search).toBe("/objects/deals/d1?alt=1");
    expect(cookie(res)).toBe("alt");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("ein Fehler beim Lesen der Einstellungen gilt als alt", async () => {
    mocks.getUserSettings.mockRejectedValue(new Error("db weg"));

    const res = await GET(anfrage("?conv=c1"));

    expect(ziel(res).pathname + ziel(res).search).toBe("/inbox?conv=c1&alt=1");
    expect(cookie(res)).toBe("alt");
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("eine ungültige Kennung landet im Posteingang, ohne die Eingabe zu spiegeln", async () => {
    const res = await GET(anfrage("?conv=../x"));

    const loc = ziel(res);
    expect(res.status).toBe(307);
    expect(loc.pathname).toBe("/app/inbox");
    expect(loc.search).toBe("");
    expect(loc.href).not.toContain("..");
    expect(cookie(res)).toBe("neu");
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
