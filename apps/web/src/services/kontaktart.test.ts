import { beforeEach, describe, expect, it, vi } from "vitest";

// Ein neuer Thread (neue Betreffzeile, anderer Kanal) einer Person, die schon
// als Bewerber, Team/Helfer oder Partner eingestuft ist, kam als Lead an:
// Agent scharf, „Neue Anfrage“-Deal. Der Eingang fragt deshalb die Kontaktart
// der Person hinter dem Inbox-Kontakt ab.
const reads = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ["from", "where", "innerJoin", "leftJoin", "orderBy"]) q[m] = () => q;
    q.limit = async () => reads.queue.shift() ?? [];
    return q;
  };
  return { db: { select: () => chain() } };
});
vi.mock("@/services/records", () => ({ updateRecord: vi.fn() }));

import { kontaktartFuerInboxKontakt } from "./kontaktart";

describe("kontaktartFuerInboxKontakt", () => {
  beforeEach(() => {
    reads.queue = [];
  });

  it("gilt ohne verknüpfte Person als Lead/Kunde", async () => {
    reads.queue = [[{ personId: null }]];
    await expect(kontaktartFuerInboxKontakt("contact")).resolves.toBe("lead_kunde");
  });

  it("liest die Kontaktart der verknüpften Person", async () => {
    reads.queue = [[{ personId: "person" }], [{ text: "opt_team", title: "Team/Helfer" }]];
    await expect(kontaktartFuerInboxKontakt("contact")).resolves.toBe("team_helfer");
  });

  it("gilt bei unbekanntem Kontakt als Lead/Kunde", async () => {
    reads.queue = [[]];
    await expect(kontaktartFuerInboxKontakt("contact")).resolves.toBe("lead_kunde");
  });
});
