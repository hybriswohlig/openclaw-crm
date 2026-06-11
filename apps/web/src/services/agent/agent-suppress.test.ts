import { describe, expect, it } from "vitest";
import { looksDeclined, leaksPriceOrCommitment } from "./agent-suppress";

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
