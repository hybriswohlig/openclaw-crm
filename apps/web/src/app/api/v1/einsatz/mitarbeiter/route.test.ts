import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EINSATZ_FEHLER_TEXT, type EinsatzPerson } from "@/lib/einsatz";
import { berlinDateString } from "@/lib/berlin-date";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladePersonen: vi.fn(),
  personAnlegen: vi.fn(),
  personAendern: vi.fn(),
  mitarbeiterImWorkspace: vi.fn(),
  abwesenheitAnlegen: vi.fn(),
  abwesenheitLoeschen: vi.fn(),
  ladeAbwesenheitenPerson: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/einsatz-personen", () => ({
  ladePersonen: mocks.ladePersonen,
  personAnlegen: mocks.personAnlegen,
  personAendern: mocks.personAendern,
  mitarbeiterImWorkspace: mocks.mitarbeiterImWorkspace,
  abwesenheitAnlegen: mocks.abwesenheitAnlegen,
  abwesenheitLoeschen: mocks.abwesenheitLoeschen,
  ladeAbwesenheitenPerson: mocks.ladeAbwesenheitenPerson,
}));

import { GET, POST } from "./route";
import { PATCH } from "./[employeeId]/route";
import { GET as absenzenGet, POST as absenzenPost } from "./[employeeId]/abwesenheiten/route";
import { DELETE } from "../abwesenheiten/[id]/route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const PERSON: EinsatzPerson = {
  id: "e1",
  name: "Ada Lovelace",
  kuerzel: "AL",
  aktiv: true,
  plz: "01067",
  wohnort: "Dresden",
  kannSprinter: false,
  eigenerPkw: false,
  satzFahrtCent: 1500,
  satzArbeitCent: 2000,
};

const anfrage = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

const mitarbeiter = (method: string, body?: unknown) => anfrage("http://localhost/api/v1/einsatz/mitarbeiter", method, body);
const eine = (method: string, body?: unknown) => anfrage("http://localhost/api/v1/einsatz/mitarbeiter/e1", method, body);
const absenzen = (method: string, body?: unknown, query = "") =>
  anfrage(`http://localhost/api/v1/einsatz/mitarbeiter/e1/abwesenheiten${query}`, method, body);
const loeschen = () => anfrage("http://localhost/api/v1/einsatz/abwesenheiten/ab1", "DELETE");

const pPerson = (employeeId = "e1") => ({ params: Promise.resolve({ employeeId }) });
const pAbwesenheit = { params: Promise.resolve({ id: "ab1" }) };

function plus(tag: string, tage: number): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + tage)).toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladePersonen.mockResolvedValue([PERSON, { ...PERSON, id: "e2", aktiv: false }]);
  mocks.personAnlegen.mockResolvedValue(PERSON);
  mocks.personAendern.mockResolvedValue(PERSON);
  mocks.mitarbeiterImWorkspace.mockResolvedValue(true);
  mocks.abwesenheitAnlegen.mockResolvedValue({ id: "ab1", employeeId: "e1", von: "2026-12-01", bis: "2026-12-02", art: "urlaub", notiz: null });
  mocks.abwesenheitLoeschen.mockResolvedValue(true);
  mocks.ladeAbwesenheitenPerson.mockResolvedValue([]);
});

describe("Einsatz-Routen: nur Menschen", () => {
  it.each(["full", "read"] as const)("API-Schlüssel %s → 403 NUR_MENSCH auf jeder Methode", async (access) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: access });
    const antworten = await Promise.all([
      GET(mitarbeiter("GET")),
      POST(mitarbeiter("POST", { name: "Ada" })),
      PATCH(eine("PATCH", { name: "Ada" }), pPerson()),
      absenzenGet(absenzen("GET"), pPerson()),
      absenzenPost(absenzen("POST", { von: "2026-12-01", bis: "2026-12-02", art: "urlaub" }), pPerson()),
      DELETE(loeschen(), pAbwesenheit),
    ]);
    for (const res of antworten) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("NUR_MENSCH");
    }
    expect(mocks.ladePersonen).not.toHaveBeenCalled();
    expect(mocks.personAnlegen).not.toHaveBeenCalled();
    expect(mocks.personAendern).not.toHaveBeenCalled();
    expect(mocks.abwesenheitAnlegen).not.toHaveBeenCalled();
    expect(mocks.abwesenheitLoeschen).not.toHaveBeenCalled();
  });
});

describe("POST/PATCH Mitarbeiter", () => {
  it("PLZ 7017 → 400 STAMMDATEN_UNGUELTIG", async () => {
    const res = await POST(mitarbeiter("POST", { name: "Ada", plz: "7017" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "STAMMDATEN_UNGUELTIG",
      message: EINSATZ_FEHLER_TEXT.STAMMDATEN_UNGUELTIG,
      feld: "PLZ_UNGUELTIG",
    });
    expect(mocks.personAnlegen).not.toHaveBeenCalled();
  });

  it("PLZ 01067 wird angelegt", async () => {
    const res = await POST(mitarbeiter("POST", { name: "Ada", plz: "01067" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: PERSON });
    expect(mocks.personAnlegen).toHaveBeenCalledWith("ws_1", expect.objectContaining({ name: "Ada", plz: "01067" }));
  });

  it("kannSprinter als Text → 400", async () => {
    const res = await POST(mitarbeiter("POST", { name: "Ada", kannSprinter: "ja" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("STAMMDATEN_UNGUELTIG");
    expect(mocks.personAnlegen).not.toHaveBeenCalled();
  });

  it("kaputtes JSON → 400 BAD_REQUEST", async () => {
    const res = await POST(mitarbeiter("POST", "kein json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("unbekannte Person → 404", async () => {
    mocks.personAendern.mockResolvedValue(null);
    const res = await PATCH(eine("PATCH", { wohnort: "Dresden" }), pPerson("fehlt"));
    expect(res.status).toBe(404);
    expect(mocks.personAendern).toHaveBeenCalledWith("ws_1", "fehlt", { wohnort: "Dresden" });
  });

  it("GET liefert auch inaktive Personen", async () => {
    const res = await GET(mitarbeiter("GET"));
    expect(res.status).toBe(200);
    const data = (await res.json()).data as EinsatzPerson[];
    expect(data.some((p) => p.aktiv === false)).toBe(true);
  });
});

describe("Abwesenheiten", () => {
  it("93 Tage → 400 ZEITRAUM_UNGUELTIG", async () => {
    const res = await absenzenPost(absenzen("POST", { von: "2026-01-01", bis: "2026-04-03", art: "urlaub" }), pPerson());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "ZEITRAUM_UNGUELTIG",
      message: EINSATZ_FEHLER_TEXT.ZEITRAUM_UNGUELTIG,
    });
    expect(mocks.abwesenheitAnlegen).not.toHaveBeenCalled();
  });

  it("unbekannte Person → 404, nichts angelegt", async () => {
    mocks.mitarbeiterImWorkspace.mockResolvedValue(false);
    const lesen = await absenzenGet(absenzen("GET"), pPerson("fehlt"));
    const schreiben = await absenzenPost(
      absenzen("POST", { von: "2026-12-01", bis: "2026-12-02", art: "krank" }),
      pPerson("fehlt"),
    );
    expect(lesen.status).toBe(404);
    expect(schreiben.status).toBe(404);
    expect(mocks.ladeAbwesenheitenPerson).not.toHaveBeenCalled();
    expect(mocks.abwesenheitAnlegen).not.toHaveBeenCalled();
  });

  it("GET nutzt das Vorgabe-Fenster, POST legt an", async () => {
    const heute = berlinDateString();
    const lesen = await absenzenGet(absenzen("GET"), pPerson());
    expect(lesen.status).toBe(200);
    expect(mocks.ladeAbwesenheitenPerson).toHaveBeenCalledWith("ws_1", "e1", plus(heute, -31), plus(heute, 400));

    const schreiben = await absenzenPost(
      absenzen("POST", { von: "2026-12-01", bis: "2026-12-02", art: "urlaub", notiz: "Ski" }),
      pPerson(),
    );
    expect(schreiben.status).toBe(201);
    expect(mocks.abwesenheitAnlegen).toHaveBeenCalledWith(
      "ws_1",
      "e1",
      { von: "2026-12-01", bis: "2026-12-02", art: "urlaub", notiz: "Ski" },
      "usr_1",
    );
  });

  it("Löschen: weg → 200, unbekannt → 404", async () => {
    const ok = await DELETE(loeschen(), pAbwesenheit);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { id: "ab1" } });
    expect(mocks.abwesenheitLoeschen).toHaveBeenCalledWith("ws_1", "ab1");

    mocks.abwesenheitLoeschen.mockResolvedValue(false);
    expect((await DELETE(loeschen(), pAbwesenheit)).status).toBe(404);
  });
});
