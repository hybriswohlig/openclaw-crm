import { describe, expect, it } from "vitest";
import {
  looksDeclined,
  leaksPriceOrCommitment,
  erkenneAnrede,
  anredeFuerOptOut,
  mitOptOutZeile,
  textHatStopHinweis,
  OPT_OUT_LINE_DU,
  OPT_OUT_LINE_SIE,
} from "./agent-suppress";

describe("looksDeclined — opt-out and decline detection", () => {
  it("matches a bare STOP (and casing/punctuation variants)", () => {
    expect(looksDeclined("STOP")).toBe(true);
    expect(looksDeclined("stop")).toBe(true);
    expect(looksDeclined("Stopp.")).toBe(true);
    expect(looksDeclined("  STOP! ")).toBe(true);
  });
  it("matches explicit opt-out phrasings", () => {
    expect(looksDeclined("Bitte keine weiteren Nachrichten")).toBe(true);
    expect(looksDeclined("abbestellen")).toBe(true);
    expect(looksDeclined("Bitte nicht mehr schreiben")).toBe(true);
  });
  it("matches clear declines", () => {
    expect(looksDeclined("Kein Interesse, danke")).toBe(true);
    expect(looksDeclined("Haben wir schon anderweitig gebucht")).toBe(true);
    expect(looksDeclined("Das hat sich erledigt")).toBe(true);
  });
  it("does NOT fire on a normal lead reply containing the letters 'stop'", () => {
    // "stop" only opts out as a standalone word, not inside other words.
    expect(looksDeclined("Wir machen einen Stopover in Stuttgart")).toBe(false);
    expect(looksDeclined("Ja, der Termin passt")).toBe(false);
    expect(looksDeclined("Können wir telefonieren?")).toBe(false);
  });
  it("empty/nullish is not a decline", () => {
    expect(looksDeclined("")).toBe(false);
    expect(looksDeclined(null)).toBe(false);
    expect(looksDeclined(undefined)).toBe(false);
  });
});

describe("leaksPriceOrCommitment — the human always makes the offer", () => {
  it("flags any price the agent named itself", () => {
    expect(leaksPriceOrCommitment("Das kostet ca. 800 Euro")).toBe(true);
    expect(leaksPriceOrCommitment("Wir machen das für 1200€")).toBe(true);
    expect(leaksPriceOrCommitment("Pauschal 950 EUR")).toBe(true);
  });
  it("flags a booking/availability commitment", () => {
    expect(leaksPriceOrCommitment("Ich habe den 1. September für dich reserviert")).toBe(true);
    expect(leaksPriceOrCommitment("Der Termin ist gebucht")).toBe(true);
    expect(leaksPriceOrCommitment("Wir haben den Termin fix eingeplant")).toBe(true);
  });
  it("does NOT flag a normal qualification question", () => {
    expect(leaksPriceOrCommitment("Steht dein Umzugstermin am 1. September schon fest?")).toBe(false);
    expect(leaksPriceOrCommitment("Von wo nach wo soll es gehen?")).toBe(false);
    expect(leaksPriceOrCommitment("Magst du kurz telefonieren?")).toBe(false);
    // a bare date mention without a commitment verb is fine to ask about
    expect(leaksPriceOrCommitment("Passt dir der 15.07. oder bist du flexibel?")).toBe(false);
  });
  it("empty/nullish never leaks", () => {
    expect(leaksPriceOrCommitment("")).toBe(false);
    expect(leaksPriceOrCommitment(null)).toBe(false);
  });
});

describe("erkenneAnrede — Sie/Ihnen/Ihr gegen du/dir/dein", () => {
  it("erkennt die Sie-Form an Sie, Ihnen und Ihr", () => {
    expect(erkenneAnrede("Können Sie mir ein Angebot schicken?")).toBe("sie");
    expect(erkenneAnrede("Guten Tag, wir erstellen Ihnen das Angebot.")).toBe("sie");
    expect(erkenneAnrede("Ihr Angebot ist angekommen, danke.")).toBe("sie");
    expect(erkenneAnrede("Vielen Dank für Ihre Nachricht.")).toBe("sie");
    expect(erkenneAnrede("Wir melden uns zu Ihrem Umzug.")).toBe("sie");
  });

  it("erkennt die Du-Form an du, dir und dein", () => {
    expect(erkenneAnrede("Hi, kannst du mir ein Angebot machen?")).toBe("du");
    expect(erkenneAnrede("Wir schicken dir die Fotos.")).toBe("du");
    expect(erkenneAnrede("Danke für deine Nachricht.")).toBe("du");
    expect(erkenneAnrede("Könnt ihr am Samstag?")).toBe("du");
    expect(erkenneAnrede("Ihr könnt am Samstag vorbeikommen.")).toBe("du");
  });

  it("verwechselt dritte Person und Satzanfang nicht mit einer Anrede", () => {
    expect(erkenneAnrede("Ich helfe ihr beim Einpacken.")).toBeNull();
    expect(erkenneAnrede("Die Wohnung gehört ihr.")).toBeNull();
    expect(erkenneAnrede("Die Kartons? Sie sind schon gepackt.")).toBeNull();
    expect(erkenneAnrede("Guten Tag, kurze Nachfrage zum Umzug.")).toBeNull();
    expect(erkenneAnrede("")).toBeNull();
    expect(erkenneAnrede(null)).toBeNull();
  });

  it("nimmt bei gemischten Signalen die Sie-Form", () => {
    expect(erkenneAnrede("Können Sie mir dein Stockwerk sagen?")).toBe("sie");
    expect(erkenneAnrede("Sagst du uns Ihre PLZ?")).toBe("sie");
  });

  it("bleibt bei wiederholten Aufrufen stabil", () => {
    const sie = "Guten Tag, wir erstellen Ihnen das Angebot.";
    const du = "Wir schicken dir die Fotos.";
    for (let i = 0; i < 5; i++) {
      expect(erkenneAnrede(sie)).toBe("sie");
      expect(erkenneAnrede(du)).toBe("du");
    }
  });
});

describe("anredeFuerOptOut — Text, sonst gespeicherte Anrede, sonst Sie", () => {
  it("lässt den Text vor der gespeicherten Anrede gewinnen", () => {
    expect(anredeFuerOptOut("Wir erstellen Ihnen das Angebot.", { deal: "du", konversation: "du" })).toBe("sie");
    expect(anredeFuerOptOut("Wir schicken dir die Fotos.", { deal: "sie", konversation: "sie" })).toBe("du");
  });

  it("nutzt die gespeicherte Anrede, wenn der Text keine hat", () => {
    const text = "Guten Tag, kurze Nachfrage zum Umzug.";
    expect(anredeFuerOptOut(text, { deal: "du" })).toBe("du");
    expect(anredeFuerOptOut(text, { konversation: "DU" })).toBe("du");
    expect(anredeFuerOptOut(text, { konversation: " sie " })).toBe("sie");
  });

  it("nimmt bei widersprüchlicher gespeicherter Anrede die Sie-Form", () => {
    expect(anredeFuerOptOut("Kurze Nachfrage.", { konversation: "du", deal: "sie" })).toBe("sie");
    expect(anredeFuerOptOut("Kurze Nachfrage.", { konversation: "formell", deal: null })).toBe("sie");
    expect(anredeFuerOptOut("Kurze Nachfrage.")).toBe("sie");
  });
});

describe("mitOptOutZeile", () => {
  it("hängt die passende Zeile an", () => {
    expect(mitOptOutZeile("Guten Tag, wir erstellen Ihnen das Angebot.")).toBe(
      `Guten Tag, wir erstellen Ihnen das Angebot.\n\n${OPT_OUT_LINE_SIE}`
    );
    expect(mitOptOutZeile("Wir schicken dir die Fotos.")).toBe(
      `Wir schicken dir die Fotos.\n\n${OPT_OUT_LINE_DU}`
    );
  });

  it("hängt nichts an, wenn schon ein STOP-Hinweis im Text steht", () => {
    const mitZeile = `Guten Tag.\n\n${OPT_OUT_LINE_SIE}`;
    expect(mitOptOutZeile(mitZeile)).toBe(mitZeile);
    expect(mitOptOutZeile("Bitte einfach stop schreiben.")).toBe("Bitte einfach stop schreiben.");
    expect(mitOptOutZeile("STOPP")).toBe("STOPP");
    expect(textHatStopHinweis("Der Stopover ist kein Problem.")).toBe(false);
    const stopover = mitOptOutZeile("Der Stopover ist kein Problem, wir melden uns bei Ihnen.");
    expect(stopover.match(/PS:/g)).toHaveLength(1);
    expect(stopover).toContain(OPT_OUT_LINE_SIE);
  });

  it("lässt leeren Text unverändert", () => {
    expect(mitOptOutZeile("")).toBe("");
    expect(mitOptOutZeile("   ")).toBe("   ");
  });
});
