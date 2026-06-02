import { describe, expect, it } from "vitest";
import { newValuesToAdd, looksLikePseudonym, pickGoldenName } from "./survivorship";

// KOT-IDENTITY survivorship unit coverage. When two people merge, the survivor
// must gain only the loser's genuinely-new, clean values, and keep a sensible
// name.

describe("newValuesToAdd — phones", () => {
  it("adds a loser phone the survivor does not have", () => {
    expect(newValuesToAdd(["+49 151 5905 8963"], ["0170 1234567"], "phone")).toEqual([
      "0170 1234567",
    ]);
  });
  it("drops a loser phone that is the same number in a different format", () => {
    // survivor has it as wa_id digits, loser pastes the national form
    expect(newValuesToAdd(["4915159058963"], ["0151 5905 8963"], "phone")).toEqual([]);
  });
  it("dedupes within the additions and drops junk", () => {
    expect(
      newValuesToAdd([], ["0170 1234567", "+49 170 1234567", "keine"], "phone")
    ).toEqual(["0170 1234567"]);
  });
});

describe("newValuesToAdd — emails", () => {
  it("adds a new real email, case-insensitively deduped", () => {
    expect(newValuesToAdd(["Kunde@GMX.de"], ["kunde@gmx.de", "neu@web.de"], "email")).toEqual([
      "neu@web.de",
    ]);
  });
  it("never copies a Kleinanzeigen relay address onto the person", () => {
    const relay =
      "abc-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de";
    expect(newValuesToAdd([], [relay], "email")).toEqual([]);
  });
});

describe("looksLikePseudonym", () => {
  it("flags empty, handles, digits, underscores, all-lowercase", () => {
    expect(looksLikePseudonym("")).toBe(true);
    expect(looksLikePseudonym("umzug_2024")).toBe(true);
    expect(looksLikePseudonym("max123")).toBe(true);
    expect(looksLikePseudonym("schnellguenstig")).toBe(true);
  });
  it("does not flag a real name", () => {
    expect(looksLikePseudonym("Anna Müller")).toBe(false);
    expect(looksLikePseudonym("Anna")).toBe(false);
  });
});

describe("pickGoldenName", () => {
  it("keeps the survivor by default", () => {
    expect(pickGoldenName("Anna Müller", "Bernd Klein")).toBe("survivor");
  });
  it("adopts the loser when the survivor is an empty / handle name", () => {
    expect(pickGoldenName("", "Anna Müller")).toBe("loser");
    expect(pickGoldenName("umzug_2024", "Anna Müller")).toBe("loser");
  });
  it("keeps the survivor when both are handles", () => {
    expect(pickGoldenName("max123", "umzug_2024")).toBe("survivor");
  });
});
