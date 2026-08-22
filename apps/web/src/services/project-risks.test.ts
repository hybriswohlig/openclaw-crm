import { describe, expect, it } from "vitest";
import { resolveRiskCreate, resolveRiskUpdate } from "./project-risks";

describe("resolveRiskCreate", () => {
  it("requires a title", () => {
    const r = resolveRiskCreate({ title: "   " });
    expect(r).toEqual({ ok: false, error: "Titel ist erforderlich." });
  });

  it("defaults severity to mittel and status to offen", () => {
    const r = resolveRiskCreate({ title: "Genehmigung verzögert sich" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      title: "Genehmigung verzögert sich",
      description: null,
      severity: "mittel",
      likelihood: null,
      status: "offen",
      mitigation: null,
      ownerUserId: null,
    });
  });

  it("rejects an unknown severity instead of silently downgrading it", () => {
    // Create and update must agree. Coercing "katastrophal" to "mittel" also
    // suppressed the §10.2 notification that only fires for 'hoch'.
    expect(resolveRiskCreate({ title: "X", severity: "katastrophal" })).toEqual({
      ok: false,
      error: "Ungültige Risiko-Schwere.",
    });
  });

  it("still defaults an omitted or empty severity to mittel", () => {
    const omitted = resolveRiskCreate({ title: "X" });
    expect(omitted.ok).toBe(true);
    if (omitted.ok) expect(omitted.values.severity).toBe("mittel");
    const empty = resolveRiskCreate({ title: "X", severity: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.values.severity).toBe("mittel");
  });

  it("keeps a valid likelihood and trims free text", () => {
    const r = resolveRiskCreate({
      title: "  Fahrzeugausfall  ",
      description: "  Ein 7,5-Tonner steht seit Juli  ",
      severity: "hoch",
      likelihood: "niedrig",
      mitigation: " Ersatzfahrzeug mieten ",
      ownerUserId: "u1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      title: "Fahrzeugausfall",
      description: "Ein 7,5-Tonner steht seit Juli",
      severity: "hoch",
      likelihood: "niedrig",
      status: "offen",
      mitigation: "Ersatzfahrzeug mieten",
      ownerUserId: "u1",
    });
  });
});

describe("resolveRiskUpdate", () => {
  it("only emits the keys that were actually sent", () => {
    const r = resolveRiskUpdate({ status: "geschlossen" });
    expect(r).toEqual({ ok: true, set: { status: "geschlossen" } });
  });

  it("rejects an empty title", () => {
    expect(resolveRiskUpdate({ title: "" })).toEqual({ ok: false, error: "Titel darf nicht leer sein." });
  });

  it("rejects an unknown status rather than silently defaulting", () => {
    expect(resolveRiskUpdate({ status: "erledigt" })).toEqual({ ok: false, error: "Ungültiger Risiko-Status." });
  });

  it("turns an empty description into null and clears likelihood", () => {
    const r = resolveRiskUpdate({ description: "  ", likelihood: null });
    expect(r).toEqual({ ok: true, set: { description: null, likelihood: null } });
  });

  it("returns an empty set when nothing was sent", () => {
    expect(resolveRiskUpdate({})).toEqual({ ok: true, set: {} });
  });
});
