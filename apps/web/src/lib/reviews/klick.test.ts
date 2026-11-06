import { describe, expect, it } from "vitest";
import { istVorschauAgent, klickKanal } from "./klick";

describe("istVorschauAgent", () => {
  it.each([
    "WhatsApp/2.23.20.0 A",
    "WhatsApp/2.2348.50 i",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Facebot",
    "TelegramBot (like TwitterBot)",
  ])("Vorschau: %s", (ua) => {
    expect(istVorschauAgent(ua)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    // Facebook-In-App-Browser ist ein echter Mensch
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]",
    null,
    "",
  ])("kein Vorschau-Agent: %s", (ua) => {
    expect(istVorschauAgent(ua)).toBe(false);
  });
});

describe("klickKanal", () => {
  const sms = { eventType: "sent_sms", channel: "sms", meta: {}, at: new Date("2026-05-10T10:00:00Z") };
  const wa = { eventType: "sent_whatsapp", channel: "whatsapp", meta: { token: "tok_wa" }, at: new Date("2026-11-10T10:00:00Z") };

  it("Kanal des Versands mit diesem Token", () => {
    expect(klickKanal([sms, wa], "tok_wa")).toBe("whatsapp");
    expect(klickKanal([wa, { ...sms, meta: { token: "tok_sms" } }], "tok_sms")).toBe("sms");
  });

  it("ohne Token im Ereignis: letzter Versand vor dem Token", () => {
    expect(klickKanal([sms, { ...wa, meta: {} }], "alt", new Date("2026-06-01T00:00:00Z"))).toBe("sms");
  });

  it("ohne passenden Versand: sms wie bisher", () => {
    expect(klickKanal([], "x")).toBe("sms");
    expect(klickKanal([{ ...wa, channel: null, meta: { token: "x" } }], "x")).toBe("whatsapp");
  });
});
