import { describe, expect, it } from "vitest";
import {
  decideCallMatch,
  parseTelefonCallPayload,
  replayFill,
  signTelefonBody,
  verifyTelefonSignature,
  callActivityTitle,
} from "./phone-calls";
import { matchStatusLabel } from "./phone-call-text";

const SECRET = "test-secret";

function body(over: Record<string, unknown> = {}) {
  return {
    externalId: "call-1",
    callerNumber: "015112345678",
    calledNumber: "070549306962",
    lineLabel: "Kottke",
    answeredBy: "Buero",
    startedAt: "2026-10-23T08:00:00.000Z",
    durationSeconds: 125,
    transcript: "Guten Tag.",
    summary: "Kurzer Anruf.",
    keywords: ["Umzug", " Stuttgart "],
    ...over,
  };
}

describe("verifyTelefonSignature", () => {
  const raw = JSON.stringify(body());

  it("accepts the hex hmac and an optional sha256 prefix", () => {
    const sig = signTelefonBody(raw, SECRET);
    expect(verifyTelefonSignature(raw, sig, SECRET)).toBe(true);
    expect(verifyTelefonSignature(raw, `sha256=${sig}`, SECRET)).toBe(true);
    expect(verifyTelefonSignature(raw, `SHA256=${sig.toUpperCase()}`, SECRET)).toBe(true);
  });

  it("rejects a missing header, the wrong secret, a short value, and a changed body", () => {
    const sig = signTelefonBody(raw, SECRET);
    expect(verifyTelefonSignature(raw, null, SECRET)).toBe(false);
    expect(verifyTelefonSignature(raw, sig, "")).toBe(false);
    expect(verifyTelefonSignature(raw, sig, "other")).toBe(false);
    expect(verifyTelefonSignature(raw, "abcd", SECRET)).toBe(false);
    expect(verifyTelefonSignature(`${raw} `, sig, SECRET)).toBe(false);
  });
});

describe("parseTelefonCallPayload", () => {
  it("keeps a valid call and trims empty text to null", () => {
    const parsed = parseTelefonCallPayload(body({ answeredBy: "  ", keywords: ["Umzug", "  ", "Termin"] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.externalId).toBe("call-1");
    expect(parsed.value.callerRaw).toBe("015112345678");
    expect(parsed.value.answeredBy).toBeNull();
    expect(parsed.value.keywords).toEqual(["Umzug", "Termin"]);
    expect(parsed.value.durationSeconds).toBe(125);
    expect(parsed.value.startedAt.toISOString()).toBe("2026-10-23T08:00:00.000Z");
  });

  it("rejects a bad envelope", () => {
    expect(parseTelefonCallPayload(null).ok).toBe(false);
    expect(parseTelefonCallPayload([]).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ externalId: "hat leerzeichen" })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ externalId: "a".repeat(129) })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ externalId: "a".repeat(128) })).ok).toBe(true);
    expect(parseTelefonCallPayload(body({ callerNumber: 15 })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ transcript: "x".repeat(100_001) })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ summary: "x".repeat(2001) })).ok).toBe(false);
  });

  it("rejects a bad time, duration, or keyword list", () => {
    expect(parseTelefonCallPayload(body({ startedAt: "gestern" })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ startedAt: "2019-12-31T23:00:00.000Z" })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ startedAt: "2020-01-01T00:00:00.000Z" })).ok).toBe(true);
    const zuWeit = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    expect(parseTelefonCallPayload(body({ startedAt: zuWeit })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ durationSeconds: 1.5 })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ durationSeconds: -1 })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ durationSeconds: 86_401 })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ durationSeconds: 0 })).ok).toBe(true);
    expect(parseTelefonCallPayload(body({ keywords: "Umzug" })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ keywords: ["ok", 1] })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ keywords: ["x".repeat(41)] })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ keywords: Array.from({ length: 13 }, (_, i) => `k${i}`) })).ok).toBe(false);
    expect(parseTelefonCallPayload(body({ keywords: Array.from({ length: 12 }, (_, i) => `k${i}`) })).ok).toBe(true);
  });
});

describe("decideCallMatch", () => {
  it("attaches exactly one live person", () => {
    expect(decideCallMatch(null, ["p1"])).toEqual({ status: "no_number", personRecordId: null });
    expect(decideCallMatch("+4915112345678", [])).toEqual({ status: "unmatched", personRecordId: null });
    expect(decideCallMatch("+4915112345678", ["p1", "p1"])).toEqual({ status: "matched", personRecordId: "p1" });
    expect(decideCallMatch("+4915112345678", ["p1", "p2"])).toEqual({ status: "ambiguous", personRecordId: null });
  });
});

describe("replayFill", () => {
  const leer = { transcript: null, summary: null, keywords: [] as string[], durationSeconds: null };

  it("fills only fields that are still empty", () => {
    expect(replayFill(leer, { ...leer, transcript: "Text", summary: "Kurz", keywords: ["A"], durationSeconds: 30 })).toEqual({
      transcript: "Text",
      summary: "Kurz",
      keywords: ["A"],
      durationSeconds: 30,
    });
    expect(
      replayFill(
        { transcript: "Alt", summary: "Alt", keywords: ["Alt"], durationSeconds: 10 },
        { transcript: "Neu", summary: "Neu", keywords: ["Neu"], durationSeconds: 99 }
      )
    ).toBeNull();
    expect(replayFill({ ...leer, transcript: "Alt" }, { ...leer, transcript: "Neu", summary: "Kurz" })).toEqual({
      summary: "Kurz",
    });
  });
});

describe("call display", () => {
  it("shows a German number, the line, and rounded minutes", () => {
    expect(
      callActivityTitle({
        callerE164: "+4915112345678",
        callerRaw: "015112345678",
        durationSeconds: 125,
        lineLabel: "Kottke",
      })
    ).toBe("Anruf von 015112345678 · Kottke · 2 Min.");
    expect(
      callActivityTitle({ callerE164: "+431234", callerRaw: null, durationSeconds: 30, lineLabel: null })
    ).toBe("Anruf von +431234 · 1 Min.");
    expect(
      callActivityTitle({ callerE164: null, callerRaw: "  ", durationSeconds: 0, lineLabel: null })
    ).toBe("Anruf von ohne Nummer");
    expect(matchStatusLabel("unmatched")).toBe("Keine Kundenkarte");
    expect(matchStatusLabel("ambiguous")).toBe("Mehrere Kunden");
    expect(matchStatusLabel("no_number")).toBe("Ohne Nummer");
  });
});
