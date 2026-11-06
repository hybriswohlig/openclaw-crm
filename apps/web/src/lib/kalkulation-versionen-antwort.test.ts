import { describe, expect, it, vi } from "vitest";

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));

import { autorAus, versionAusPfad, versionsFehlerAntwort } from "./kalkulation-versionen-antwort";
import { UebersteuerungFehler } from "./kalkulation-versionen";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "member" as const, permissions: {} as never };

describe("autorAus", () => {
  it("Sitzung → mensch, API-Schlüssel → agent", () => {
    expect(autorAus({ ...CTX, authMethod: "cookie" })).toEqual({ userId: "usr_1", quelle: "mensch" });
    expect(autorAus(CTX)).toEqual({ userId: "usr_1", quelle: "mensch" });
    expect(autorAus({ ...CTX, authMethod: "api_key" })).toEqual({ userId: "usr_1", quelle: "agent" });
  });
});

describe("versionAusPfad", () => {
  it("nur positive ganze Zahlen", () => {
    expect(versionAusPfad("1")).toBe(1);
    expect(versionAusPfad("42")).toBe(42);
    for (const s of ["", "0", "-1", "1.5", "01", "1e3", " 1", "abc", "2147483648"]) expect(versionAusPfad(s)).toBeNull();
  });
});

describe("versionsFehlerAntwort", () => {
  it("VersionsFehler mit Status und Code", async () => {
    const res = versionsFehlerAntwort(new VersionsFehler("SPANNE", "Spanne bestätigen"))!;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "SPANNE", message: "Spanne bestätigen" } });
  });

  it("Annahme → 409 KVA_ACCEPTED, Übersteuerung → 400, Rest null", async () => {
    const a = versionsFehlerAntwort(new AngebotAngenommenError())!;
    expect(a.status).toBe(409);
    expect((await a.json()).error.code).toBe("KVA_ACCEPTED");
    const u = versionsFehlerAntwort(new UebersteuerungFehler("Grund fehlt"))!;
    expect(u.status).toBe(400);
    expect((await u.json()).error.message).toBe("Grund fehlt");
    expect(versionsFehlerAntwort(new Error("x"))).toBeNull();
  });
});
