import { describe, expect, it } from "vitest";
import {
  fensterZu,
  freigabeBody,
  freigabeFehler,
  gateGruende,
  nachStart,
  posteingangUrl,
  sendeFehler,
  startFolge,
} from "./gespraech-texte";

describe("sendeFehler", () => {
  it("übersetzt die bekannten Codes der Senderoute", () => {
    expect(sendeFehler("WA_SESSION_EXPIRED", "egal")).toBe("24-Stunden-Fenster zu.");
    expect(sendeFehler("BAILEYS_BRIDGE_NOT_CONFIGURED", "")).toBe("WhatsApp ist für diese Nummer nicht verbunden.");
    expect(sendeFehler("BAILEYS_BRIDGE_ERROR", "")).toBe("WhatsApp hat nicht geantwortet. Bitte erneut senden.");
  });

  it("hängt sonst den Servertext an „Senden fehlgeschlagen.“", () => {
    expect(sendeFehler("OPENCLAW_OUTBOUND_NOT_IMPLEMENTED", "Outbound not implemented")).toBe(
      "Senden fehlgeschlagen. Outbound not implemented"
    );
    expect(sendeFehler(null, "  ")).toBe("Senden fehlgeschlagen.");
  });
});

describe("freigabeFehler", () => {
  it("nennt die Gate-Gründe deutsch", () => {
    expect(freigabeFehler("gate_blocked", ["consent_unknown_person"])).toBe(
      "Gesperrt: Keine Einwilligung für diese Person."
    );
    expect(freigabeFehler("gate_blocked", ["human_owned", "ai_paused"])).toBe(
      "Gesperrt: Von Hand übernommen. Automatik an diesem Gespräch pausiert."
    );
  });

  it("zeigt keine rohen Codes: unbekannte Gründe werden zur allgemeinen Sperre, nur einmal", () => {
    expect(freigabeFehler("gate_blocked", ["irgendwas_neues", "noch_was"])).toBe(
      "Gesperrt: Senden ist für diesen Kunden gesperrt."
    );
    expect(freigabeFehler("gate_blocked", [])).toBe("Gesperrt: Senden ist für diesen Kunden gesperrt.");
    expect(freigabeFehler("gate_blocked")).toBe("Gesperrt: Senden ist für diesen Kunden gesperrt.");
  });

  it("meint mit outside_send_window die Ruhezeiten des Agenten, nicht das WABA-Fenster", () => {
    expect(gateGruende(["outside_send_window"])).toEqual([
      "Außerhalb der Sendezeit (8 bis 20 Uhr, sonntags 10 bis 19 Uhr).",
    ]);
  });

  it("kennt Präfixe für beendete Sequenzen und Stufen", () => {
    expect(gateGruende(["stopped_kunde_hat_geantwortet", "stage_disallows_followup"])).toEqual([
      "Sequenz beendet.",
      "Stufe erlaubt diese Nachricht nicht.",
    ]);
  });

  it("rät bei fehlendem Gespräch nicht zum erneuten Versuch", () => {
    expect(freigabeFehler("no_conversation")).toBe("Kein Gespräch für diesen Entwurf.");
    expect(freigabeFehler("no_conversation")).not.toContain("erneut");
  });

  it("nimmt das Detail des Servers für Fenster und unklare Zustellung, sonst den Standardtext", () => {
    expect(freigabeFehler("session_expired", undefined, "24h-Fenster abgelaufen")).toBe("24h-Fenster abgelaufen");
    expect(freigabeFehler("session_expired")).toBe("24-Stunden-Fenster zu.");
    expect(freigabeFehler("send_uncertain", undefined, "  ")).toBe(
      "Zustellung unklar. Bitte den Verlauf prüfen, nichts erneut senden."
    );
  });

  it("hat für die übrigen Fehlerworte feste Texte", () => {
    expect(freigabeFehler("expired")).toBe("Entwurf abgelaufen.");
    expect(freigabeFehler("stale")).toBe("Kunde hat neu geschrieben, der Entwurf ist überholt.");
    expect(freigabeFehler("not_pending")).toBe("Bereits bearbeitet.");
    expect(freigabeFehler("price_leak")).toBe("Preisprüfung hat blockiert. Bitte von Hand prüfen und senden.");
    expect(freigabeFehler("send_failed")).toBe("Senden fehlgeschlagen. Bitte erneut versuchen.");
    expect(freigabeFehler(undefined)).toBe("Senden fehlgeschlagen. Bitte erneut versuchen.");
  });
});

describe("fensterZu", () => {
  it("sperrt nur WABA mit geschlossenem Fenster", () => {
    expect(fensterZu({ istWaba: true, imFenster: false })).toBe(true);
    expect(fensterZu({ istWaba: true, imFenster: true })).toBe(false);
    expect(fensterZu({ istWaba: true, imFenster: null })).toBe(false);
    expect(fensterZu({ istWaba: false, imFenster: false })).toBe(false);
    expect(fensterZu({ istWaba: false, imFenster: null })).toBe(false);
    expect(fensterZu(undefined)).toBe(false);
  });
});

describe("startFolge", () => {
  it("führt ohne Gespräch zur Verfassen-Seite der alten Inbox, mit derselben Abfrage wie die Datensatztabelle", () => {
    const folge = startFolge({
      mode: "compose",
      channelAccountId: "konto-1",
      toPhone: "+491550000201",
      customerName: "Familie Weber",
      dealRecordId: "deal-1",
    });
    expect(folge).toEqual({
      art: "verfassen",
      url: "/inbox?compose=1&channelAccountId=konto-1&phone=%2B491550000201&name=Familie+Weber&dealRecordId=deal-1",
    });
  });

  it("kodiert Sonderzeichen im Namen, damit & und # die Abfrage nicht zerreißen", () => {
    const folge = startFolge({
      mode: "compose",
      channelAccountId: "konto-1",
      toPhone: "+491550000201",
      customerName: "Müller & Söhne #3",
      dealRecordId: "deal-1",
    });
    expect(folge.art).toBe("verfassen");
    const url = folge.art === "verfassen" ? folge.url : "";
    expect(url).toBe(
      "/inbox?compose=1&channelAccountId=konto-1&phone=%2B491550000201&name=M%C3%BCller+%26+S%C3%B6hne+%233&dealRecordId=deal-1"
    );
    expect(new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("name")).toBe("Müller & Söhne #3");
  });

  it("lädt bei vorhandenem Gespräch die Akte neu", () => {
    expect(startFolge({ mode: "open", conversationId: "g-1" })).toEqual({ art: "neu_laden", conversationId: "g-1" });
  });

  it("meldet alles andere als unbekannt", () => {
    expect(startFolge(null)).toEqual({ art: "unbekannt" });
    expect(startFolge({ mode: "open" })).toEqual({ art: "unbekannt" });
    expect(startFolge({ mode: "compose", channelAccountId: "k" })).toEqual({ art: "unbekannt" });
    expect(startFolge("open")).toEqual({ art: "unbekannt" });
  });
});

describe("nachStart", () => {
  const kanaele = [
    { gespraechId: "mail", kannSenden: true },
    { gespraechId: "wa-fremd", kannSenden: false },
  ];

  it("wählt das Gespräch, wenn es nach dem Neuladen direkt am Deal und sendefähig ist", () => {
    expect(nachStart([...kanaele, { gespraechId: "wa-neu", kannSenden: true }], "wa-neu")).toEqual({
      art: "waehlen",
      gespraechId: "wa-neu",
    });
  });

  it("zeigt bei einem weiter indirekten Gespräch den Hinweis mit Sprung in den Posteingang", () => {
    expect(nachStart(kanaele, "wa-fremd")).toEqual({
      art: "hinweis",
      text: "Das WhatsApp-Gespräch hängt an einem anderen Deal und lässt sich hier nicht senden.",
      link: { url: "/inbox?conv=wa-fremd", text: "Im Posteingang öffnen" },
    });
  });

  it("behandelt ein Gespräch, das die Akte gar nicht kennt, wie ein indirektes", () => {
    expect(nachStart(kanaele, "unbekannt").art).toBe("hinweis");
  });
});

describe("posteingangUrl", () => {
  it("öffnet das Gespräch in der alten Inbox", () => {
    expect(posteingangUrl("g 1")).toBe("/inbox?conv=g%201");
  });
});

describe("freigabeBody", () => {
  it("schickt beim Freigeben des unveränderten Entwurfs keinen eigenen Text, damit die Veraltet-Prüfung greift", () => {
    const body = freigabeBody();
    expect(body).toEqual({ action: "approve_and_send", humanApproved: true });
    expect("finalText" in body).toBe(false);
  });
});
