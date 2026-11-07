import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hier = dirname(fileURLToPath(import.meta.url));

/** `url:`-Zeilen im ersten Argument von `sendPush(`. */
function pushUrlZeilen(src: string): string[] {
  const zeilen: string[] = [];
  for (const teil of src.split("sendPush(").slice(1)) {
    const block = teil.slice(0, teil.indexOf(");"));
    for (const zeile of block.split("\n")) {
      if (/^\s*url:/.test(zeile)) zeilen.push(zeile.trim());
    }
  }
  return zeilen;
}

describe("Push-Links der Agenten", () => {
  const dateien = ["agent/agent-worker.ts", "agent/agent-first-contact.ts", "agent/agent-followup.ts"];

  for (const datei of dateien) {
    it(`${datei} übergibt sendPush nur noch Weichen-Links`, () => {
      const src = readFileSync(resolve(hier, datei), "utf8");
      expect(src).toContain('from "@/lib/handy-links"');
      expect(src).toContain("weiterLink");
      const zeilen = pushUrlZeilen(src);
      expect(zeilen.length).toBeGreaterThan(0);
      for (const zeile of zeilen) {
        expect(zeile).not.toContain("/objects/deals/");
        expect(zeile).not.toContain('"/inbox"');
        expect(zeile).toContain("weiterLink");
      }
    });
  }
});
