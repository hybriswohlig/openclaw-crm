import { describe, it, expect } from "vitest";
import {
  CUSTOMER_REPLY_RED_FLAG_KEYWORDS,
  INTERNAL_RED_FLAG_KEYWORDS,
  scanCustomerReply,
  scanInternalNotes,
} from "./valve";

// KOT-624 unit coverage for the negative-experience valve (KOT-615).
// Spec source: KOT-596 §6.1 (internal red flags) and §6.2 (customer
// reply red flags). The CEO priority is "false negatives are not
// acceptable" — every keyword in the canonical list must match its
// own sentence at minimum.

describe("scanInternalNotes — internal red-flag keyword coverage (spec §6.1)", () => {
  for (const kw of INTERNAL_RED_FLAG_KEYWORDS) {
    it(`matches the keyword "${kw}" when present in a sentence`, () => {
      const note = `Crew lead reported: ${kw} während des Umzugs.`;
      const result = scanInternalNotes(note);
      expect(result.matched).toBe(true);
      expect(result.hits).toContain(kw);
    });
  }
});

describe("scanCustomerReply — customer-reply red-flag coverage (spec §6.2)", () => {
  for (const kw of CUSTOMER_REPLY_RED_FLAG_KEYWORDS) {
    it(`matches the keyword "${kw}" when present in a customer reply`, () => {
      const reply = `Hallo, leider war ${kw} bei uns ein Thema.`;
      const result = scanCustomerReply(reply);
      expect(result.matched).toBe(true);
      expect(result.hits).toContain(kw);
    });
  }
});

describe("normalization — diacritics and case", () => {
  it("treats 'verspaetet' (ae digraph) the same as 'verspätet' (umlaut)", () => {
    const withDigraph = scanInternalNotes("Lieferung war verspaetet");
    const withUmlaut = scanInternalNotes("Lieferung war verspätet");
    expect(withDigraph.matched).toBe(true);
    expect(withUmlaut.matched).toBe(true);
    expect(withDigraph.hits).toEqual(withUmlaut.hits);
  });

  it("treats 'beschaedigt' (ae digraph) the same as 'beschädigt'", () => {
    const a = scanCustomerReply("Vasen kamen beschaedigt an.");
    const b = scanCustomerReply("Vasen kamen beschädigt an.");
    expect(a.matched).toBe(true);
    expect(b.matched).toBe(true);
    expect(a.hits).toEqual(b.hits);
  });

  it("is case-insensitive — 'BESCHÄDIGT' hits", () => {
    const result = scanCustomerReply("ALLES BESCHÄDIGT, KOMPLETTES CHAOS");
    expect(result.matched).toBe(true);
    expect(result.hits).toContain("beschädigt");
  });

  it("normalizes 'ß' to 'ss' so 'großartig' does not accidentally collide with red flags", () => {
    const result = scanCustomerReply("alles großartig gelaufen, herzlichen dank");
    expect(result.matched).toBe(false);
    expect(result.hits).toEqual([]);
  });
});

describe("negative cases — happy-path messages must not match", () => {
  const happy = [
    "alles war perfekt",
    "wirklich tolles Team, sehr zuvorkommend",
    "10 von 10, gerne wieder",
    "vielen dank, super schnell und sauber",
  ];
  for (const msg of happy) {
    it(`returns matched=false for "${msg}"`, () => {
      const result = scanCustomerReply(msg);
      expect(result.matched).toBe(false);
      expect(result.hits).toEqual([]);
    });
  }
});

describe("input guards", () => {
  it("returns matched=false for null", () => {
    expect(scanInternalNotes(null)).toEqual({ matched: false, hits: [] });
    expect(scanCustomerReply(null)).toEqual({ matched: false, hits: [] });
  });

  it("returns matched=false for undefined", () => {
    expect(scanInternalNotes(undefined)).toEqual({ matched: false, hits: [] });
    expect(scanCustomerReply(undefined)).toEqual({ matched: false, hits: [] });
  });

  it("returns matched=false for an empty string", () => {
    expect(scanInternalNotes("")).toEqual({ matched: false, hits: [] });
    expect(scanCustomerReply("")).toEqual({ matched: false, hits: [] });
  });
});

describe("routing safety — complaint-flagged notes must not mint review_tokens or call sendSms", () => {
  // The cron pipeline (apps/web/src/app/api/cron/reviews-send/route.ts)
  // checks scanInternalNotes(internalNotes).matched BEFORE generating
  // a review_tokens row or invoking sendSms. This test pins the contract
  // at the library boundary: a flagged note returns matched=true with
  // populated hits, so the cron's `if (valve.matched) { routeAsComplaint();
  // continue; }` branch is the only path taken. The actual cron call-site
  // is integration-tested separately (see KOT-624 §4 follow-up).

  it("flags a note that includes an internal red-flag keyword", () => {
    const flagged = "Kunde war unzufrieden, Möbel kamen beschädigt an.";
    const result = scanInternalNotes(flagged);
    expect(result.matched).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("does not flag a clean note", () => {
    const clean = "Alles glatt gelaufen, Kunde happy, Crew pünktlich.";
    const result = scanInternalNotes(clean);
    expect(result.matched).toBe(false);
  });
});
