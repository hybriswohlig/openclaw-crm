import { describe, expect, it } from "vitest";
import { offeneMeldungen } from "./zahlungsmeldungen";

const meldung = (id: string, zeit: string, variant: "deposit" | "final", amountCents: unknown = 48000, method: unknown = "bank_transfer") => ({
  id,
  eventType: "customer.marked_paid",
  payload: { method, amountCents, variant, ipAddress: "1.2.3.4", userAgent: "x" },
  createdAt: new Date(zeit),
});
const bestaetigt = (id: string, zeit: string, eventId: string, variante: "deposit" | "final") => ({
  id,
  eventType: "payment.meldung_bestaetigt",
  payload: { eventId, paymentId: "pay_1", variante },
  createdAt: new Date(zeit),
});
const verworfen = (id: string, zeit: string, eventId: string, variante: "deposit" | "final") => ({
  id,
  eventType: "payment.meldung_verworfen",
  payload: { eventId, variante },
  createdAt: zeit,
});

describe("offeneMeldungen", () => {
  it("zwei „final“-Taps → eine Meldung, die neuere", () => {
    const r = offeneMeldungen([
      meldung("e1", "2026-11-04T10:00:00Z", "final", 48000),
      meldung("e2", "2026-11-04T10:05:00Z", "final", 52000, "paypal"),
    ]);
    expect(r).toEqual([
      { eventId: "e2", gemeldetAm: "2026-11-04T10:05:00.000Z", betragCent: 52000, zahlungsart: "paypal", variante: "final" },
    ]);
  });

  it("deposit bestätigt, final offen → nur final", () => {
    const r = offeneMeldungen([
      meldung("d1", "2026-11-01T09:00:00Z", "deposit", 20000),
      bestaetigt("b1", "2026-11-01T12:00:00Z", "d1", "deposit"),
      meldung("f1", "2026-11-05T09:00:00Z", "final", 60000),
    ]);
    expect(r.map((m) => m.eventId)).toEqual(["f1"]);
  });

  it("final verworfen → leer, auch ältere Meldungen derselben Variante", () => {
    const r = offeneMeldungen([
      meldung("f1", "2026-11-05T09:00:00Z", "final"),
      meldung("f2", "2026-11-05T09:01:00Z", "final"),
      verworfen("v1", "2026-11-05T10:00:00Z", "f2", "final"),
    ]);
    expect(r).toEqual([]);
  });

  it("neue final-Meldung nach einer Bestätigung → wieder offen", () => {
    const r = offeneMeldungen([
      meldung("f1", "2026-11-05T09:00:00Z", "final"),
      bestaetigt("b1", "2026-11-05T10:00:00Z", "f1", "final"),
      meldung("f2", "2026-11-05T11:00:00Z", "final", 1000),
    ]);
    expect(r.map((m) => m.eventId)).toEqual(["f2"]);
  });

  it("Folgeereignis einer anderen Variante schließt nicht", () => {
    const r = offeneMeldungen([
      meldung("f1", "2026-11-05T09:00:00Z", "final"),
      bestaetigt("b1", "2026-11-05T10:00:00Z", "d0", "deposit"),
    ]);
    expect(r.map((m) => m.eventId)).toEqual(["f1"]);
  });

  it("Folgeereignis mit derselben eventId schließt auch bei gleichem Zeitstempel", () => {
    const r = offeneMeldungen([
      meldung("f1", "2026-11-05T09:00:00Z", "final"),
      bestaetigt("b1", "2026-11-05T09:00:00Z", "f1", "final"),
    ]);
    expect(r).toEqual([]);
  });

  it("Payload ohne gültiges amountCents übersprungen; ältere gültige Meldung bleibt", () => {
    const r = offeneMeldungen([
      meldung("f1", "2026-11-05T09:00:00Z", "final", 30000),
      meldung("f2", "2026-11-05T09:01:00Z", "final", "300"),
      meldung("f3", "2026-11-05T09:02:00Z", "final", 0),
      meldung("f4", "2026-11-05T09:03:00Z", "final", 12.5),
      { id: "f5", eventType: "customer.marked_paid", payload: null, createdAt: new Date("2026-11-05T09:04:00Z") },
    ]);
    expect(r.map((m) => m.eventId)).toEqual(["f1"]);
  });

  it("unbekannte Zahlungsart → null, unbekannte Variante übersprungen", () => {
    const r = offeneMeldungen([
      meldung("d1", "2026-11-01T09:00:00Z", "deposit", 20000, "krypto"),
      { ...meldung("x1", "2026-11-02T09:00:00Z", "final"), payload: { amountCents: 100, variant: "rest" } },
    ]);
    expect(r).toEqual([
      { eventId: "d1", gemeldetAm: "2026-11-01T09:00:00.000Z", betragCent: 20000, zahlungsart: null, variante: "deposit" },
    ]);
  });

  it("Reihenfolge der Eingabe egal; deposit vor final", () => {
    const r = offeneMeldungen([
      meldung("f2", "2026-11-05T11:00:00Z", "final"),
      meldung("d1", "2026-11-01T09:00:00Z", "deposit"),
      meldung("f1", "2026-11-05T09:00:00Z", "final"),
    ]);
    expect(r.map((m) => m.eventId)).toEqual(["d1", "f2"]);
  });
});
