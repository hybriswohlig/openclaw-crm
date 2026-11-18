import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { KV_EDITOR_STATUS, KV_EDITOR_TEXT, type KvStandKopf } from "@/lib/kv-editor";
import { KvEditorFehlerKlasse } from "@/services/kv-editor-fehler";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ansicht: vi.fn(),
  standLesen: vi.fn(),
  standKopfLesen: vi.fn(),
  standPdf: vi.fn(),
  standAnlegen: vi.fn(),
  neuDrucken: vi.fn(),
  pushen: vi.fn(),
  konflikteEntscheiden: vi.fn(),
  uebertragen: vi.fn(),
  kvChat: vi.fn(),
  kvChatVerlauf: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`@/db im Test (${String(p)})`);
      },
    }
  ),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/kv-editor", () => ({
  ansicht: mocks.ansicht,
  standLesen: mocks.standLesen,
  standKopfLesen: mocks.standKopfLesen,
  standPdf: mocks.standPdf,
  standAnlegen: mocks.standAnlegen,
  neuDrucken: mocks.neuDrucken,
  pushen: mocks.pushen,
  konflikteEntscheiden: mocks.konflikteEntscheiden,
  uebertragen: mocks.uebertragen,
  kvChat: mocks.kvChat,
  kvChatVerlauf: mocks.kvChatVerlauf,
}));

import { GET as ansichtGet } from "./route";
import { POST as standAnlegenPost } from "./staende/route";
import { GET as standGet } from "./staende/[standId]/route";
import { GET as kopfGet } from "./staende/[standId]/kopf/route";
import { GET as pdfGet } from "./staende/[standId]/pdf/route";
import { POST as neuDruckenPost } from "./staende/[standId]/neu-drucken/route";
import { POST as pushenPost } from "./staende/[standId]/pushen/route";
import { POST as uebertragenPost } from "./staende/[standId]/uebertragen/route";
import { POST as konfliktePost } from "./konflikte/route";
import { GET as chatGet, POST as chatPost, maxDuration } from "./chat/route";

const CTX = {
  userId: "usr_1",
  workspaceId: "ws_1",
  workspaceRole: "admin" as const,
  authMethod: "cookie" as const,
  permissions: {},
};
const WER_ADMIN = { userId: "usr_1", admin: true };
const WER_MEMBER = { userId: "usr_1", admin: false };

const KOPF: KvStandKopf = {
  id: "stand_1",
  nummer: 2,
  vorgaengerId: "stand_0",
  renderer: "vps",
  kalkulationVersion: 3,
  quelle: "hand",
  status: "fertig",
  fehler: null,
  aenderungen: [],
  offen: [],
  erstelltVon: { id: "usr_1", name: "Nuri" },
  erstelltAm: "2026-11-18T10:00:00.000Z",
  gepushtVon: null,
  gepushtAm: null,
  aktuell: false,
  dealDocumentId: "doc_1",
  grundlageRekonstruiert: false,
  pruefung: null,
};

const STAND_BODY = {
  vorgaengerId: "stand_0",
  setzen: [
    { schluessel: "umzug.anrede", wert: "Guten Tag", extra: 1 },
    { schluessel: "umzug.zeigen", wert: true },
  ],
  zuruecksetzen: ["umzug.hinweis"],
  kiNachrichtId: "msg_1",
  fremd: "weg",
};
const STAND_ERWARTET = {
  vorgaengerId: "stand_0",
  setzen: [
    { schluessel: "umzug.anrede", wert: "Guten Tag" },
    { schluessel: "umzug.zeigen", wert: true },
  ],
  zuruecksetzen: ["umzug.hinweis"],
  kiNachrichtId: "msg_1",
};

function anfrage(methode: "GET" | "POST", pfad: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/deals/deal_1/kv-editor${pfad}`, {
    method: methode,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
  });
}

function dealParams() {
  return { params: Promise.resolve({ recordId: "deal_1" }) };
}
function standParams() {
  return { params: Promise.resolve({ recordId: "deal_1", standId: "stand_1" }) };
}

type Dienst = ReturnType<typeof vi.fn>;

/** Eine Route: Aufruf, gemockter Dienst, Erfolg. */
const ROUTEN: {
  name: string;
  dienst: Dienst;
  status: number;
  daten: unknown;
  args: unknown[];
  laden: () => Promise<Response>;
}[] = [
  {
    name: "GET /kv-editor",
    dienst: mocks.ansicht,
    status: 200,
    daten: { dealId: "deal_1" },
    args: ["ws_1", "deal_1", WER_ADMIN],
    laden: () => ansichtGet(anfrage("GET", ""), dealParams()),
  },
  {
    name: "GET /staende/[standId]",
    dienst: mocks.standLesen,
    status: 200,
    daten: { id: "stand_1" },
    args: ["ws_1", "deal_1", "stand_1"],
    laden: () => standGet(anfrage("GET", "/staende/stand_1"), standParams()),
  },
  {
    name: "GET /staende/[standId]/kopf",
    dienst: mocks.standKopfLesen,
    status: 200,
    daten: { id: "stand_1", status: "druckt" },
    args: ["ws_1", "deal_1", "stand_1"],
    laden: () => kopfGet(anfrage("GET", "/staende/stand_1/kopf"), standParams()),
  },
  {
    name: "GET /staende/[standId]/pdf",
    dienst: mocks.standPdf,
    status: 200,
    daten: null,
    args: ["ws_1", "deal_1", "stand_1"],
    laden: () => pdfGet(anfrage("GET", "/staende/stand_1/pdf"), standParams()),
  },
  {
    name: "POST /staende",
    dienst: mocks.standAnlegen,
    status: 201,
    daten: KOPF,
    args: ["ws_1", "deal_1", STAND_ERWARTET, "usr_1"],
    laden: () => standAnlegenPost(anfrage("POST", "/staende", STAND_BODY), dealParams()),
  },
  {
    name: "POST /neu-drucken",
    dienst: mocks.neuDrucken,
    status: 201,
    daten: KOPF,
    args: ["ws_1", "deal_1", "stand_1", "usr_1"],
    laden: () => neuDruckenPost(anfrage("POST", "/staende/stand_1/neu-drucken"), standParams()),
  },
  {
    name: "POST /pushen",
    dienst: mocks.pushen,
    status: 200,
    daten: { stand: KOPF, dealDocumentId: "doc_2", annahmeAufgehoben: false },
    args: ["ws_1", "deal_1", "stand_1", { erwartetAktuellDokumentId: "doc_1", annahmeAufhebenBestaetigt: false }, WER_ADMIN],
    laden: () =>
      pushenPost(
        anfrage("POST", "/staende/stand_1/pushen", {
          erwartetAktuellDokumentId: "doc_1",
          annahmeAufhebenBestaetigt: false,
          fremd: "weg",
        }),
        standParams()
      ),
  },
  {
    name: "POST /uebertragen",
    dienst: mocks.uebertragen,
    status: 201,
    daten: KOPF,
    args: ["ws_1", "deal_1", "stand_1", "usr_1"],
    laden: () => uebertragenPost(anfrage("POST", "/staende/stand_1/uebertragen"), standParams()),
  },
  {
    name: "POST /konflikte",
    dienst: mocks.konflikteEntscheiden,
    status: 200,
    daten: { stand: KOPF, neuerEntwurf: null },
    args: [
      "ws_1",
      "deal_1",
      { standId: "stand_1", entscheidungen: [{ schluessel: "umzug.anrede", aktion: "uebernehmen" }] },
      "usr_1",
    ],
    laden: () =>
      konfliktePost(
        anfrage("POST", "/konflikte", {
          standId: "stand_1",
          entscheidungen: [{ schluessel: "umzug.anrede", aktion: "uebernehmen", extra: true }],
          fremd: 1,
        }),
        dealParams()
      ),
  },
  {
    name: "GET /chat",
    dienst: mocks.kvChatVerlauf,
    status: 200,
    daten: [],
    args: ["ws_1", "deal_1"],
    laden: () => chatGet(anfrage("GET", "/chat"), dealParams()),
  },
  {
    name: "POST /chat",
    dienst: mocks.kvChat,
    status: 200,
    daten: { antwort: "Ok", vorschlaege: [], abgelehnt: [], nachrichtId: "msg_2" },
    args: ["ws_1", "deal_1", { standId: "stand_1", text: "Bitte kürzer." }, "usr_1"],
    laden: () =>
      chatPost(
        anfrage("POST", "/chat", { standId: "stand_1", text: "  Bitte kürzer.  ", modell: "weg" }),
        dealParams()
      ),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  for (const route of ROUTEN) route.dienst.mockResolvedValue(route.daten);
});

describe("KV-Editor-Routen", () => {
  it.each(ROUTEN)("$name ohne Anmeldung → 401, Dienst nicht aufgerufen", async ({ dienst, laden }) => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await laden();
    expect(res.status).toBe(401);
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
    expect(dienst).not.toHaveBeenCalled();
  });

  it.each(ROUTEN)("$name mit API-Schlüssel → 403 NUR_MENSCH, Deal und Dienst nicht gelesen", async ({ dienst, laden }) => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key" });
    const res = await laden();
    expect(res.status).toBe(KV_EDITOR_STATUS.NUR_MENSCH);
    expect(await res.json()).toEqual(new KvEditorFehlerKlasse("NUR_MENSCH").antwort());
    expect(mocks.dealImWorkspace).not.toHaveBeenCalled();
    expect(dienst).not.toHaveBeenCalled();
  });

  it.each(ROUTEN)("$name fremder Workspace → 404 KEIN_KV, Dienst nicht aufgerufen", async ({ dienst, laden }) => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await laden();
    expect(res.status).toBe(KV_EDITOR_STATUS.KEIN_KV);
    expect(await res.json()).toEqual(new KvEditorFehlerKlasse("KEIN_KV", "Deal nicht gefunden.").antwort());
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(dienst).not.toHaveBeenCalled();
  });

  it.each(ROUTEN.filter((r) => r.name !== "GET /staende/[standId]/pdf"))(
    "$name Erfolg → { data } und richtige Argumente",
    async ({ dienst, status, daten, args, laden }) => {
      dienst.mockResolvedValue(daten);
      const res = await laden();
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ data: daten });
      expect(dienst).toHaveBeenCalledWith(...args);
    }
  );
});

describe("Fehlerabbildung", () => {
  async function abbilden(
    laden: () => Promise<Response>,
    dienst: Dienst,
    fehler: KvEditorFehlerKlasse
  ) {
    dienst.mockRejectedValue(fehler);
    const res = await laden();
    expect(res.status).toBe(KV_EDITOR_STATUS[fehler.code]);
    expect(await res.json()).toEqual(fehler.antwort());
  }

  const jsonRouten = ROUTEN.filter((r) => r.name !== "GET /staende/[standId]/pdf");

  it("KEIN_KV 404 bei fremdem Stand", async () => {
    const route = jsonRouten.find((r) => r.name === "GET /staende/[standId]")!;
    await abbilden(route.laden, route.dienst, new KvEditorFehlerKlasse("KEIN_KV"));
  });

  it("STAND_VERALTET 409 mit daten.neuester", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /staende")!;
    await abbilden(
      route.laden,
      route.dienst,
      new KvEditorFehlerKlasse("STAND_VERALTET", KV_EDITOR_TEXT.STAND_VERALTET, { neuester: KOPF })
    );
  });

  it("UNGUELTIG 400 mit daten.abgelehnt", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /konflikte")!;
    await abbilden(
      route.laden,
      route.dienst,
      new KvEditorFehlerKlasse("UNGUELTIG", KV_EDITOR_TEXT.UNGUELTIG, {
        abgelehnt: [{ schluessel: "umzug.anrede", grund: "TYP" }],
      })
    );
  });

  it("ANGABEN_FEHLEN 400 mit daten.text", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /neu-drucken")!;
    await abbilden(
      route.laden,
      route.dienst,
      new KvEditorFehlerKlasse("ANGABEN_FEHLEN", KV_EDITOR_TEXT.ANGABEN_FEHLEN, { text: "Telefon fehlt." })
    );
  });

  it("VPS_FEHLER 502", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /uebertragen")!;
    await abbilden(route.laden, route.dienst, new KvEditorFehlerKlasse("VPS_FEHLER"));
  });

  it("LAEUFT 409", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /chat")!;
    await abbilden(route.laden, route.dienst, new KvEditorFehlerKlasse("LAEUFT"));
  });

  it("KI_FEHLER 504", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /chat")!;
    await abbilden(route.laden, route.dienst, new KvEditorFehlerKlasse("KI_FEHLER"));
  });

  it("ANNAHME_AKTIV 409", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /pushen")!;
    await abbilden(
      route.laden,
      route.dienst,
      new KvEditorFehlerKlasse("ANNAHME_AKTIV", KV_EDITOR_TEXT.ANNAHME_AKTIV, { am: "2026-11-01", standNummer: 4 })
    );
  });

  it("NUR_ADMIN 403 aus dem Dienst", async () => {
    const route = jsonRouten.find((r) => r.name === "POST /pushen")!;
    await abbilden(route.laden, route.dienst, new KvEditorFehlerKlasse("NUR_ADMIN"));
  });

  it.each(jsonRouten.filter((r) => !["GET /staende/[standId]", "POST /staende", "POST /neu-drucken", "POST /uebertragen", "GET /chat", "POST /chat", "POST /pushen", "POST /konflikte"].includes(r.name)))(
    "$name bildet KEIN_KV ab",
    async ({ laden, dienst }) => {
      await abbilden(laden, dienst, new KvEditorFehlerKlasse("KEIN_KV"));
    }
  );

  it("PDF-Route bildet Dienstfehler ab", async () => {
    await abbilden(
      () => pdfGet(anfrage("GET", "/staende/stand_1/pdf"), standParams()),
      mocks.standPdf,
      new KvEditorFehlerKlasse("KEIN_KV")
    );
  });

  it("unbekannter Fehler wird 500 INTERN als JSON (Aufgabe 8, Review 9)", async () => {
    mocks.ansicht.mockRejectedValue(new Error("x"));
    const fehlerLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ansichtGet(anfrage("GET", ""), dealParams());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERN");
    fehlerLog.mockRestore();
  });
});

describe("Pushen und Rollen", () => {
  it("Member mit annahmeAufhebenBestaetigt → 403 NUR_ADMIN, Dienst nicht aufgerufen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, workspaceRole: "member" });
    const res = await pushenPost(
      anfrage("POST", "/staende/stand_1/pushen", { erwartetAktuellDokumentId: "doc_1", annahmeAufhebenBestaetigt: true }),
      standParams()
    );
    expect(res.status).toBe(KV_EDITOR_STATUS.NUR_ADMIN);
    expect(await res.json()).toEqual(new KvEditorFehlerKlasse("NUR_ADMIN").antwort());
    expect(mocks.pushen).not.toHaveBeenCalled();
  });

  it("Member ohne Bestätigung ruft den Dienst mit admin: false", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, workspaceRole: "member" });
    mocks.pushen.mockResolvedValue({ ok: true });
    const res = await pushenPost(
      anfrage("POST", "/staende/stand_1/pushen", { erwartetAktuellDokumentId: null }),
      standParams()
    );
    expect(res.status).toBe(200);
    expect(mocks.pushen).toHaveBeenCalledWith(
      "ws_1",
      "deal_1",
      "stand_1",
      { erwartetAktuellDokumentId: null },
      WER_MEMBER
    );
  });

  it("Admin mit Bestätigung → 200, Dienst mit admin: true", async () => {
    mocks.pushen.mockResolvedValue({ ok: true });
    const res = await pushenPost(
      anfrage("POST", "/staende/stand_1/pushen", { erwartetAktuellDokumentId: "doc_1", annahmeAufhebenBestaetigt: true }),
      standParams()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(mocks.pushen).toHaveBeenCalledWith(
      "ws_1",
      "deal_1",
      "stand_1",
      { erwartetAktuellDokumentId: "doc_1", annahmeAufhebenBestaetigt: true },
      WER_ADMIN
    );
  });

  it("GET Ansicht: wer.admin je Rolle", async () => {
    mocks.ansicht.mockResolvedValue({ dealId: "deal_1" });
    await ansichtGet(anfrage("GET", ""), dealParams());
    expect(mocks.ansicht).toHaveBeenCalledWith("ws_1", "deal_1", WER_ADMIN);

    mocks.getAuthContext.mockResolvedValue({ ...CTX, workspaceRole: "member" });
    await ansichtGet(anfrage("GET", ""), dealParams());
    expect(mocks.ansicht).toHaveBeenLastCalledWith("ws_1", "deal_1", WER_MEMBER);
  });
});

describe("Eingaben", () => {
  async function ungueltig(res: Response, dienst: Dienst) {
    expect(res.status).toBe(KV_EDITOR_STATUS.UNGUELTIG);
    expect(await res.json()).toEqual(new KvEditorFehlerKlasse("UNGUELTIG", "Eingabe ungültig.").antwort());
    expect(dienst).not.toHaveBeenCalled();
  }

  it("kaputtes JSON → 400 UNGUELTIG", async () => {
    await ungueltig(await standAnlegenPost(anfrage("POST", "/staende", "{"), dealParams()), mocks.standAnlegen);
  });

  it("fehlende Pflichtfelder → 400 UNGUELTIG", async () => {
    await ungueltig(await standAnlegenPost(anfrage("POST", "/staende", { setzen: [], zuruecksetzen: [] }), dealParams()), mocks.standAnlegen);
  });

  it("wert als Zahl → 400 UNGUELTIG", async () => {
    await ungueltig(
      await standAnlegenPost(
        anfrage("POST", "/staende", {
          vorgaengerId: "stand_0",
          setzen: [{ schluessel: "umzug.anrede", wert: 12 }],
          zuruecksetzen: [],
        }),
        dealParams()
      ),
      mocks.standAnlegen
    );
  });

  it("Chat-Text leer, nur Leerzeichen oder zu lang → 400 UNGUELTIG", async () => {
    for (const text of ["", "   \n\t", "x".repeat(4001)]) {
      mocks.kvChat.mockClear();
      await ungueltig(await chatPost(anfrage("POST", "/chat", { standId: "stand_1", text }), dealParams()), mocks.kvChat);
    }
  });

  it("Chat-Text wird getrimmt durchgereicht, Fremdfelder nicht", async () => {
    mocks.kvChat.mockResolvedValue({ antwort: "Ok" });
    const res = await chatPost(
      anfrage("POST", "/chat", { standId: "stand_1", text: "  hallo  ", zusatz: true }),
      dealParams()
    );
    expect(res.status).toBe(200);
    expect(mocks.kvChat).toHaveBeenCalledWith("ws_1", "deal_1", { standId: "stand_1", text: "hallo" }, "usr_1");
  });

  it("entscheidungen leer → 400 UNGUELTIG", async () => {
    await ungueltig(
      await konfliktePost(anfrage("POST", "/konflikte", { standId: "stand_1", entscheidungen: [] }), dealParams()),
      mocks.konflikteEntscheiden
    );
  });

  it("aktion unbekannt → 400 UNGUELTIG", async () => {
    await ungueltig(
      await konfliktePost(
        anfrage("POST", "/konflikte", {
          standId: "stand_1",
          entscheidungen: [{ schluessel: "umzug.anrede", aktion: "loeschen" }],
        }),
        dealParams()
      ),
      mocks.konflikteEntscheiden
    );
  });
});

describe("PDF", () => {
  it("liefert die Bytes mit den PDF-Headern", async () => {
    const bytes = Buffer.from("pdf-inhalt");
    mocks.standPdf.mockResolvedValue({ fileName: "KV Müller.pdf", mimeType: "application/pdf", bytes });
    const res = await pdfGet(anfrage("GET", "/staende/stand_1/pdf"), standParams());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition") ?? "").toMatch(/^inline;/);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect(mocks.standPdf).toHaveBeenCalledWith("ws_1", "deal_1", "stand_1");
  });

  it("null → 404 KEIN_KV", async () => {
    mocks.standPdf.mockResolvedValue(null);
    const res = await pdfGet(anfrage("GET", "/staende/stand_1/pdf"), standParams());
    expect(res.status).toBe(KV_EDITOR_STATUS.KEIN_KV);
    expect(await res.json()).toEqual(
      new KvEditorFehlerKlasse("KEIN_KV", "Für diesen Stand gibt es noch kein PDF.").antwort()
    );
  });
});

describe("Chat", () => {
  it("exportiert maxDuration 120", () => {
    expect(maxDuration).toBe(120);
  });
});
