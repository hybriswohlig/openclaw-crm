import { expect, it } from "vitest";
import { sichtbareAktivitaet } from "./startseite-aktivitaet";

const ev = (id: string, eventType: string, payload: Record<string, unknown> = {}) => ({ id, eventType, payload });

it("Statuswechsel außerhalb der Deal-Stufe erscheinen nicht als „Phase geändert“", () => {
  const liste = [
    ev("1", "deal.stage_changed", { attributeSlug: "stage" }),
    ev("2", "deal.stage_changed", { attributeSlug: "review_request_status" }),
    ev("3", "deal.stage_changed", {}),
    ev("4", "message.received", { attributeSlug: "egal" }),
  ];
  expect(sichtbareAktivitaet(liste).map((e) => e.id)).toEqual(["1", "3", "4"]);
});

it("payload fehlt oder ist kein Objekt: bleibt sichtbar", () => {
  expect(sichtbareAktivitaet([{ id: "x", eventType: "deal.stage_changed", payload: null }])).toHaveLength(1);
});
