import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    const passthrough = () => q;
    q.from = passthrough;
    q.innerJoin = passthrough;
    q.where = passthrough;
    q.limit = async () => reads.queue.shift() ?? [];
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(reads.queue.shift() ?? []).then(resolve, reject);
    return q;
  };
  return { db: { select: () => chain() } };
});

import { loadLeadContext } from "./lead-context";

const personAttribut = { id: "attr_people", slug: "associated_people", type: "record_reference" };
const personWert = { attributeId: "attr_people", referencedRecordId: "person_1" };

/** Deals-Objekt, Personen-Attribut, eine Referenz, dann die Namenszeile. */
function mitPerson(nameZeile: Record<string, unknown>) {
  reads.queue = [[{ id: "obj_deals" }], [personAttribut], [personWert], [nameZeile]];
}

beforeEach(() => {
  reads.queue = [];
});

describe("loadLeadContext", () => {
  it("liefert null, wenn kein Deals-Objekt existiert", async () => {
    reads.queue = [[]];
    await expect(loadLeadContext("ws_1", "deal_1")).resolves.toBeNull();
  });

  it("liest Vor- und Nachname aus jsonValue", async () => {
    mitPerson({
      textValue: null,
      jsonValue: { firstName: "Anna", lastName: "Schmidt" },
      type: "personal_name",
    });
    await expect(loadLeadContext("ws_1", "deal_1")).resolves.toMatchObject({
      person_name: "Anna Schmidt",
      person_vorname: "Anna",
      person_nachname: "Schmidt",
    });
  });

  it("nimmt beim Textnamen das letzte Wort als Nachname", async () => {
    mitPerson({
      textValue: "Anna Maria Schmidt",
      jsonValue: null,
      type: "text",
    });
    await expect(loadLeadContext("ws_1", "deal_1")).resolves.toMatchObject({
      person_name: "Anna Maria Schmidt",
      person_vorname: "Anna Maria",
      person_nachname: "Schmidt",
    });
  });
});
