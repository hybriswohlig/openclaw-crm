import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ istVerschickt: vi.fn() }));
vi.mock("@/services/kalkulation-versionen-speicher", () => ({ istVerschickt: (...a: unknown[]) => mocks.istVerschickt(...a) }));

import { verschicktFuerSchluessel } from "./verschickt-sperre";

beforeEach(() => mocks.istVerschickt.mockReset());

describe("verschicktFuerSchluessel (Plan 16, Review I4)", () => {
  it("Schlüssel am verschickten Angebot: 409 AENDERUNG_NUR_MENSCH", async () => {
    mocks.istVerschickt.mockResolvedValue(true);
    const r = await verschicktFuerSchluessel({ authMethod: "api_key", workspaceId: "ws" }, "deal");
    expect(r?.status).toBe(409);
    expect((await r!.json()).error.code).toBe("AENDERUNG_NUR_MENSCH");
  });
  it("Sitzung fragt gar nicht, Schlüssel ohne Versand darf", async () => {
    expect(await verschicktFuerSchluessel({ authMethod: "cookie", workspaceId: "ws" }, "deal")).toBeNull();
    expect(mocks.istVerschickt).not.toHaveBeenCalled();
    mocks.istVerschickt.mockResolvedValue(false);
    expect(await verschicktFuerSchluessel({ authMethod: "api_key", workspaceId: "ws" }, "deal")).toBeNull();
  });
});
