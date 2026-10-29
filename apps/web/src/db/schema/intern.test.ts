import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { internRueckfragen } from "./index";

describe("intern_rueckfragen", () => {
  it("hat die Spalten und Indizes für Rückfragen", () => {
    const config = getTableConfig(internRueckfragen);
    expect(config.name).toBe("intern_rueckfragen");
    expect(config.columns.map((column) => column.name).sort()).toEqual(
      ["answered_at", "antwort", "antwort_von", "code", "created_at", "empfaenger", "expires_at", "frage", "id", "optionen", "payload", "quelle", "sent_at", "status", "workspace_id"].sort(),
    );
    const indexes = Object.fromEntries(config.indexes.map((index) => [index.config.name, index.config]));
    expect(Object.keys(indexes).sort()).toEqual(["intern_rueckfragen_offen_code_idx", "intern_rueckfragen_quelle_idx", "intern_rueckfragen_ws_status_idx"]);
    expect(indexes.intern_rueckfragen_offen_code_idx?.unique).toBe(true);
    expect(indexes.intern_rueckfragen_offen_code_idx?.where).toBeTruthy();
    expect(config.foreignKeys).toHaveLength(1);
  });
});
