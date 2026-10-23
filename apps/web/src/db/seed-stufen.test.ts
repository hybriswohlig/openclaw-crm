import { describe, expect, it } from "vitest";
import { DEAL_STAGES } from "@openclaw-crm/shared";
import { fehlendeSeedStufen } from "./seed-stufen";

const v = (title: string, stageCategory: string | null = null) => ({ title, stageCategory });
const titel = (stufen: { title: string }[]) => stufen.map((s) => s.title);

describe("fehlendeSeedStufen", () => {
  it("legt in einem leeren Workspace alle Seed-Stufen an", () => {
    expect(titel(fehlendeSeedStufen([], DEAL_STAGES))).toEqual(titel(DEAL_STAGES));
  });

  it("legt neben den deutschen Stufen keine englischen Dubletten an", () => {
    const produktion = [
      v("Neue Anfrage", "open_new"),
      v("In Kontakt", "open_engaged"),
      v("Angebot", "quoted"),
      v("Geplant", "booked"),
      v("Durchgeführt", "done_unpaid"),
      v("Bezahlt (Abgeschlossen)", "paid"),
      v("Verloren", "lost"),
    ];
    expect(fehlendeSeedStufen(produktion, DEAL_STAGES)).toEqual([]);
  });

  it("erkennt die Bedeutung auch ohne gepflegte Kategorie am Titel", () => {
    expect(titel(fehlendeSeedStufen([v("Geplant"), v("Verloren")], DEAL_STAGES))).not.toContain("Planned");
  });

  it("ergänzt nur, was fehlt", () => {
    const ohneAngebot = [v("Neue Anfrage", "open_new"), v("In Kontakt", "open_engaged"), v("Geplant", "booked")];
    expect(titel(fehlendeSeedStufen(ohneAngebot, DEAL_STAGES))).toEqual(["Quoted", "Done", "Paid", "Lost"]);
  });

  it("überspringt gleiche Titel unabhängig von Groß- und Kleinschreibung", () => {
    expect(titel(fehlendeSeedStufen([v("planned")], DEAL_STAGES))).not.toContain("Planned");
  });
});
