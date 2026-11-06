import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Liest die SQL-Datei und das Journal. Die Migration schreibt nur
// payments.payment_method um, und nur dort, wo der Altwert eindeutig ist.
// Ein zweiter Lauf trifft die Bedingung `<> '<ziel>'` nicht mehr.

const ABBILDUNGEN = [
  { quellen: ["ueberweisung", "überweisung"], ziel: "bank_transfer" },
  { quellen: ["bar"], ziel: "cash" },
  { quellen: ["karte", "ec", "ec-karte"], ziel: "card" },
  { quellen: ["paypal"], ziel: "paypal" },
] as const;

function anweisungen(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((block) =>
      block
        .split("\n")
        .filter((zeile) => !zeile.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((block) => block.length > 0);
}

function kompakt(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("Migration 0058 Zahlungsart", () => {
  it("enthält nur UPDATE auf payments, ohne ALTER TABLE und ohne Constraint", () => {
    const sql = readFileSync(new URL("./0058_zahlungsart.sql", import.meta.url), "utf8");
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/\bCONSTRAINT\b/i);
    expect(sql).not.toMatch(/\bCHECK\b/i);

    const teile = anweisungen(sql);
    expect(teile).toHaveLength(ABBILDUNGEN.length);
    for (const teil of teile) {
      expect(kompakt(teil)).toMatch(/^UPDATE "payments" SET /);
    }
  });

  it("bildet Altwerte über lower(trim(payment_method)) ab und schließt das Ziel aus", () => {
    const sql = readFileSync(new URL("./0058_zahlungsart.sql", import.meta.url), "utf8");
    const teile = anweisungen(sql).map(kompakt);

    for (const abbildung of ABBILDUNGEN) {
      const treffer = teile.filter(
        (teil) =>
          teil.includes("lower(trim(payment_method))") &&
          new RegExp(`SET payment_method = '${abbildung.ziel}'`).test(teil) &&
          new RegExp(`payment_method <> '${abbildung.ziel}'`).test(teil) &&
          abbildung.quellen.every((quelle) => teil.includes(`'${quelle}'`))
      );
      expect(treffer, abbildung.ziel).toHaveLength(1);
    }
  });

  it("steht im Journal mit idx 58, tag 0058_zahlungsart und when 1793232000000", () => {
    const journal = JSON.parse(
      readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8")
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const eintrag = journal.entries.find((e) => e.tag === "0058_zahlungsart");
    expect(eintrag).toMatchObject({
      idx: 58,
      tag: "0058_zahlungsart",
      when: 1793232000000,
    });
  });
});
