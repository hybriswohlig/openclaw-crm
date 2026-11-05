import { describe, expect, it } from "vitest";
import {
  ASSISTENT_MINDESTABSTAND_MS,
  istOffensichtlicheWerbung,
  neuesteKundenNachricht,
  sollAssistentLaufen,
  type AssistentCursor,
} from "./assistant-lauf";

const STUNDE = ASSISTENT_MINDESTABSTAND_MS;

function cursor(teil: Partial<AssistentCursor> = {}): AssistentCursor {
  return {
    inboundId: null,
    inboundAt: null,
    action: null,
    at: null,
    ...teil,
  };
}

describe("neuesteKundenNachricht", () => {
  it("nimmt die eingehende Nachricht mit dem spätesten Eingang", () => {
    const neueste = neuesteKundenNachricht([
      { id: "a", direction: "inbound", createdAt: 10 },
      { id: "b", direction: "outbound", createdAt: 30 },
      { id: "c", direction: "inbound", createdAt: 20 },
    ]);
    expect(neueste).toEqual({ id: "c", at: 20 });
  });

  it("löst gleichen Eingang stabil über die Id auf", () => {
    const neueste = neuesteKundenNachricht([
      { id: "m1", direction: "inbound", createdAt: 5 },
      { id: "m2", direction: "inbound", createdAt: 5 },
    ]);
    expect(neueste?.id).toBe("m2");
  });

  it("liefert null ohne Kundennachricht", () => {
    expect(neuesteKundenNachricht([{ id: "o", direction: "outbound", createdAt: 1 }])).toBeNull();
  });
});

describe("sollAssistentLaufen", () => {
  const nachricht = { id: "msg-1", at: 1_000 };
  const jetzt = 10_000_000;

  it("ruft auf, wenn der Assistent diese Unterhaltung noch nie gesehen hat", () => {
    expect(
      sollAssistentLaufen({ letzteEingehende: nachricht, cursor: cursor(), jetzt })
    ).toEqual({ aufrufen: true, grund: "neu" });
  });

  it("ruft nicht auf, wenn keine Kundennachricht da ist", () => {
    expect(sollAssistentLaufen({ letzteEingehende: null, cursor: cursor(), jetzt })).toEqual({
      aufrufen: false,
      grund: "keine_nachricht",
    });
  });

  it.each(["no_op", "handoff", "ask"] as const)(
    "behandelt %s für dieselbe Nachricht als erledigt, auch nach Stunden",
    (action) => {
      expect(
        sollAssistentLaufen({
          letzteEingehende: nachricht,
          cursor: cursor({
            inboundId: "msg-1",
            inboundAt: nachricht.at,
            action,
            at: jetzt - 5 * STUNDE,
          }),
          jetzt,
        })
      ).toEqual({ aufrufen: false, grund: "bereits_erledigt" });
    }
  );

  it("bleibt bei derselben Id erledigt, auch wenn der Zeitstempel abweicht", () => {
    expect(
      sollAssistentLaufen({
        letzteEingehende: { id: "msg-1", at: nachricht.at + 50 },
        cursor: cursor({ inboundId: "msg-1", inboundAt: nachricht.at, action: "no_op", at: jetzt - STUNDE }),
        jetzt,
      }).aufrufen
    ).toBe(false);
  });

  it("ruft bei einer neueren Kundennachricht wieder auf, sobald die Stunde um ist", () => {
    expect(
      sollAssistentLaufen({
        letzteEingehende: { id: "msg-2", at: nachricht.at + 5_000 },
        cursor: cursor({
          inboundId: "msg-1",
          inboundAt: nachricht.at,
          action: "ask",
          at: jetzt - STUNDE,
        }),
        jetzt,
      })
    ).toEqual({ aufrufen: true, grund: "neu" });
  });

  it("blockt eine neuere Nachricht innerhalb der Stunde (Sicherheitsnetz)", () => {
    expect(
      sollAssistentLaufen({
        letzteEingehende: { id: "msg-2", at: nachricht.at + 5_000 },
        cursor: cursor({
          inboundId: "msg-1",
          inboundAt: nachricht.at,
          action: "ask",
          at: jetzt - STUNDE + 1,
        }),
        jetzt,
      })
    ).toEqual({ aufrufen: false, grund: "stundenlimit" });
  });

  it("blockt eine Stunde, wenn der letzte Aufruf kein Ergebnis gespeichert hat", () => {
    expect(
      sollAssistentLaufen({
        letzteEingehende: nachricht,
        cursor: cursor({ at: jetzt - 60_000 }),
        jetzt,
      })
    ).toEqual({ aufrufen: false, grund: "stundenlimit" });
  });

  it("versucht es nach einer Stunde erneut, wenn kein Ergebnis gespeichert wurde", () => {
    expect(
      sollAssistentLaufen({
        letzteEingehende: nachricht,
        cursor: cursor({ at: jetzt - STUNDE }),
        jetzt,
      })
    ).toEqual({ aufrufen: true, grund: "neu" });
  });

  it("behandelt eine ältere zweite Id nicht als neue Nachricht", () => {
    expect(
      sollAssistentLaufen({
        letzteEingehende: { id: "alt", at: 500 },
        cursor: cursor({ inboundId: "msg-1", inboundAt: 1_000, action: "handoff", at: jetzt - 2 * STUNDE }),
        jetzt,
      })
    ).toEqual({ aufrufen: false, grund: "bereits_erledigt" });
  });
});

describe("istOffensichtlicheWerbung", () => {
  it("erkennt Bing Places und Google Business ohne LLM", () => {
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "Bing Places <noreply@places.bing.com>",
        subject: "Ihr Eintrag bei Bing Places",
        body: "Aktualisieren Sie Ihre Öffnungszeiten.",
      }).spam
    ).toBe(true);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "businessprofile-noreply@google.com",
        subject: "Google Business Profile: neue Rezension",
        body: "Jemand hat Ihr Unternehmen bewertet.",
      }).spam
    ).toBe(true);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@microsoft.com",
        subject: "Bing Places for Business",
        body: "Claim your listing.",
      }).spam
    ).toBe(true);
  });

  it("erkennt Newsletter, Systempost und noreply mit Abmelde-Hinweis", () => {
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "newsletter@shop.example",
        subject: "Nur diese Woche",
        body: "Zum Abbestellen hier klicken.",
      }).spam
    ).toBe(true);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "mailer-daemon@example.com",
        subject: "Undelivered Mail Returned to Sender",
        body: "Delivery failed.",
      }).spam
    ).toBe(true);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@firma.example",
        subject: "Unser Katalog",
        body: "Unsubscribe from this list.",
      }).spam
    ).toBe(true);
  });

  it("lässt Portal-Anfragen durch, auch von noreply", () => {
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@moebeltransport24.de",
        subject: "Neue Umzugsanfrage",
        body: "Kunde sucht ein Angebot für einen Umzug.",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@möbeltransport24.de",
        subject: "Neue Anfrage",
        body: "Bitte um Rückruf.",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@immobilienscout24.de",
        subject: "IS24 Umzugsanfrage: ID 123 / Anna",
        body: "Umzug von Stuttgart nach Esslingen.",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "kunde-abc-ek-ek@mail.kleinanzeigen.de",
        subject: "Neue Nutzer-Anfrage zu deiner Anzeige",
        body: "Ist der Termin noch frei?",
      }).spam
    ).toBe(false);
  });

  it("lässt unbekannte Portale und echte Kunden durch", () => {
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@neues-umzugsportal.example",
        subject: "Neue Anfrage",
        body: "Guten Tag, wir ziehen von München nach Berlin.",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "newsletter@shop.example",
        subject: "Umzugsunternehmen gesucht",
        body: "Ein Kunde möchte ein Angebot.",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "anna.mueller@gmx.de",
        subject: "Anfrage Umzug",
        body: "Können Sie nächste Woche?",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "max@microsoft.com",
        subject: "Umzug",
        body: "Ich brauche ein Angebot für meinen Umzug.",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "email",
        fromAddr: "noreply@unbekannt.example",
        subject: "Sie haben eine Nachricht",
        body: "Bitte im Portal antworten.",
      }).spam
    ).toBe(false);
  });

  it("verwirft keine WhatsApp- oder SMS-Nachricht", () => {
    expect(
      istOffensichtlicheWerbung({
        channelType: "whatsapp",
        fromAddr: "noreply@places.bing.com",
        subject: "Bing Places",
        body: "Werbung",
      }).spam
    ).toBe(false);
    expect(
      istOffensichtlicheWerbung({
        channelType: "sms",
        body: "newsletter unsubscribe",
      }).spam
    ).toBe(false);
  });
});
