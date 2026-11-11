import { afterEach, describe, expect, it, vi } from "vitest";
import type { Kurzfassung } from "@/lib/inbox-neu";
import type { Gespraech, GespraechKanal } from "@/services/gespraech";
import { kvNachrichtWeg, sendeZiel } from "./kv-nachricht";

function kanal(teil: Partial<GespraechKanal>): GespraechKanal {
  return {
    gespraechId: "g1",
    kanal: "whatsapp",
    name: "WhatsApp",
    kontoId: "k1",
    istWaba: false,
    telefon: "+4917000000",
    kundeName: "Max Berger",
    direkt: true,
    kannSenden: true,
    imFenster: null,
    ...teil,
  } as GespraechKanal;
}

function gespraech(kanaele: GespraechKanal[], vorauswahl: string | null = kanaele[0]?.gespraechId ?? null): Gespraech {
  return { eintraege: [], kanaele, vorauswahl };
}

const KURZ = {
  name: "Max Berger",
  kunde: { telefon: "+4917000000", email: null, von: null, nach: null, quelle: null, firma: "Kottke Entrümpelung & Umzüge" },
} as unknown as Kurzfassung;

/** fetch-Attrappe: Antworten je Methode und Pfad, alles andere 404. */
function fetchMit(antworten: Record<string, { status?: number; body: unknown }>) {
  const aufrufe: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const schluessel = `${init?.method ?? "GET"} ${url}`;
      aufrufe.push(schluessel);
      const a = antworten[schluessel];
      if (!a) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "nicht da" } }), { status: 404 });
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    })
  );
  return aufrufe;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendeZiel", () => {
  it("nimmt die Vorauswahl unter den sendefähigen Gesprächen und meldet das geschlossene Fenster", () => {
    expect(sendeZiel(gespraech([]))).toBeNull();
    expect(sendeZiel(gespraech([kanal({ kannSenden: false })]))).toBeNull();
    expect(sendeZiel(gespraech([kanal({})]))).toEqual({ fensterZu: false });
    expect(sendeZiel(gespraech([kanal({ istWaba: true, imFenster: false })]))).toEqual({ fensterZu: true });
    expect(sendeZiel(gespraech([kanal({ istWaba: true, imFenster: true })]))).toEqual({ fensterZu: false });
  });
});

describe("kvNachrichtWeg", () => {
  const LINK = "/api/v1/customer-link/d1";
  const ANGEBOT = "/api/v1/deals/d1/quotation";

  it("legt einen fehlenden Link an und legt den Text ins Eingabefeld, ohne zu senden", async () => {
    const aufrufe = fetchMit({
      [`POST ${LINK}`]: { body: { data: { url: "https://p/s/tok", dealNumber: "2026-003" } } },
      [`GET ${ANGEBOT}`]: { body: { data: { fixedPrice: "2480.00", isVariable: false } } },
    });
    const weg = await kvNachrichtWeg("d1", KURZ, gespraech([kanal({})]));
    expect(weg.art).toBe("einfuegen");
    if (weg.art !== "einfuegen") return;
    expect(weg.fensterZu).toBe(false);
    expect(weg.text).toContain("Hallo Max,");
    expect(weg.text).toContain("dein Angebot (Auftrag 2026-003) ist fertig. Der Festpreis liegt bei 2.480 €.");
    expect(weg.text).toContain("https://p/s/tok");
    expect(aufrufe).toContain(`GET ${LINK}`);
    expect(aufrufe).toContain(`POST ${LINK}`);
    // Nie eine Nachricht senden.
    expect(aufrufe.some((a) => a.includes("/messages") || a.includes("send"))).toBe(false);
  });

  it("öffnet ohne Gespräch das Verfassen-Fenster über den bestehenden Weg", async () => {
    fetchMit({
      [`GET ${LINK}`]: { body: { data: { url: "https://p/s/tok", dealNumber: null, revokedAt: null } } },
      [`GET ${ANGEBOT}`]: { body: { data: null } },
      ["POST /api/v1/inbox/whatsapp/start-from-record"]: {
        body: { data: { mode: "compose", channelAccountId: "acc1", toPhone: "+4917000000", customerName: "Max Berger", dealRecordId: "d1" } },
      },
    });
    const weg = await kvNachrichtWeg("d1", KURZ, gespraech([]));
    expect(weg).toMatchObject({
      art: "verfassen",
      vorgabe: { channelAccountId: "acc1", telefon: "+4917000000", name: "Max Berger", dealRecordId: "d1" },
    });
  });

  it("schickt keinen gesperrten Link und nennt den Weg zum Entsperren", async () => {
    const aufrufe = fetchMit({
      [`GET ${LINK}`]: { body: { data: { url: "https://p/s/tok", revokedAt: "2026-11-01T10:00:00Z" } } },
      [`GET ${ANGEBOT}`]: { body: { data: null } },
    });
    const weg = await kvNachrichtWeg("d1", KURZ, gespraech([kanal({})]));
    expect(weg).toMatchObject({ art: "meldung", titel: "Kunden-Link ist gesperrt.", ziel: { href: "/objects/deals/d1?alt=1" } });
    expect(aufrufe).not.toContain(`POST ${LINK}`);
  });

  it("nennt Pakete aus den Paketoptionen und holt die fehlende Kurzfassung (Kottke duzt)", async () => {
    const aufrufe = fetchMit({
      [`GET ${LINK}`]: { body: { data: { url: "https://p/s/tok", revokedAt: null } } },
      [`GET ${ANGEBOT}`]: { body: { data: { fixedPrice: "2480.00", isVariable: false } } },
      ["GET /api/v1/deals/d1/package-options"]: { body: { data: { options: [{ priceCents: 199000 }, { priceCents: 249000 }, { priceCents: 299000 }] } } },
      ["GET /api/v1/deals/d1/kurzfassung"]: { body: { data: KURZ } },
    });
    const weg = await kvNachrichtWeg("d1", null, gespraech([kanal({})]));
    expect(aufrufe).toContain("GET /api/v1/deals/d1/kurzfassung");
    expect(weg.art === "einfuegen" && weg.text).toContain("Du kannst zwischen 3 Paketen wählen, ab 1.990 € zum Festpreis.");
  });

  it("gibt nach „WhatsApp starten“ mit offenem Gespräch dessen Kennung mit", async () => {
    fetchMit({
      [`GET ${LINK}`]: { body: { data: { url: "https://p/s/tok", revokedAt: null } } },
      ["POST /api/v1/inbox/whatsapp/start-from-record"]: { body: { data: { mode: "open", conversationId: "conv-9" } } },
    });
    const weg = await kvNachrichtWeg("d1", KURZ, gespraech([]));
    expect(weg).toMatchObject({ art: "neu_laden", gespraechId: "conv-9" });
  });

  it("legt bei gescheitertem Start den fertigen Text bei", async () => {
    fetchMit({
      [`GET ${LINK}`]: { body: { data: { url: "https://p/s/tok", revokedAt: null } } },
      ["POST /api/v1/inbox/whatsapp/start-from-record"]: { status: 400, body: { error: { code: "NO_PHONE", message: "Keine Nummer." } } },
    });
    const weg = await kvNachrichtWeg("d1", KURZ, gespraech([]));
    expect(weg).toMatchObject({ art: "meldung", text: "Keine Nummer." });
    expect(weg.art === "meldung" && weg.nachricht).toContain("https://p/s/tok");
  });

  it("meldet ein ausgeschaltetes Portal", async () => {
    fetchMit({
      [`POST ${LINK}`]: { body: { data: { url: null, skipped: true } } },
      [`GET ${ANGEBOT}`]: { body: { data: null } },
    });
    const weg = await kvNachrichtWeg("d1", KURZ, gespraech([kanal({})]));
    expect(weg).toMatchObject({ art: "meldung", titel: "Kundenportal ist für diese Firma aus." });
  });
});
