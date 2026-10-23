import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  entscheideAnrufLead,
  istOffeneStufe,
  leadNameAusDialog,
  leadsPersonenId,
  nameAusZusammenfassung,
  personNameWert,
  sperrSchluessel,
  statusNachLead,
  zeigeLeadKnopf,
  type AnrufLeadLage,
  type AnrufStatus,
  type PersonenKarte,
} from "./phone-call-lead";

const EINS: PersonenKarte = { id: "p1", name: "Ada" };
const ZWEI: PersonenKarte = { id: "p2", name: "Bea" };
const LEAD_A: PersonenKarte = { id: "d1", name: "Ada" };
const LEAD_B: PersonenKarte = { id: "d2", name: "Ada zweiter" };

function lage(ueber: Partial<AnrufLeadLage> = {}): AnrufLeadLage {
  return {
    matchStatus: "unmatched",
    dealRecordId: null,
    callerE164: "+4915112345678",
    angehaengtePersonId: null,
    personen: [],
    offeneLeads: [],
    wahl: null,
    name: "Ada Lovelace",
    ...ueber,
  };
}

describe("Lead aus Anruf", () => {
  it("zweiter Klick, Lead schon gesetzt: nichts anlegen", () => {
    const entscheid = entscheideAnrufLead(lage({ dealRecordId: "d-da", name: null, personen: [EINS] }));
    expect(entscheid).toEqual({ art: "fertig", dealRecordId: "d-da" });
  });

  it("matched und ambiguous brechen ab", () => {
    expect(entscheideAnrufLead(lage({ matchStatus: "matched", personen: [EINS] })).art).toBe("abbruch");
    const mehrdeutig = entscheideAnrufLead(lage({ matchStatus: "ambiguous", personen: [EINS, ZWEI] }));
    expect(mehrdeutig).toMatchObject({ art: "abbruch", grund: "ambiguous", karten: [EINS, ZWEI] });
  });

  it("unmatched mit 0, 1 oder 2 Personen", () => {
    const neu = entscheideAnrufLead(lage());
    expect(neu).toMatchObject({ art: "anlegen", person: { neu: true, name: "Ada Lovelace" }, telefon: "+4915112345678" });

    const eine = entscheideAnrufLead(lage({ personen: [EINS], name: "Wird ignoriert", offeneLeads: [] }));
    expect(eine).toMatchObject({ art: "anlegen", person: { neu: false, id: "p1" }, telefon: null });

    const zwei = entscheideAnrufLead(lage({ personen: [EINS, ZWEI] }));
    expect(zwei).toMatchObject({ art: "abbruch", grund: "mehrere_personen", karten: [EINS, ZWEI] });
  });

  it("no_number legt eine Person ohne Nummer an, die Nummernprüfung spielt keine Rolle", () => {
    const entscheid = entscheideAnrufLead(
      lage({ matchStatus: "no_number", callerE164: null, personen: [EINS, ZWEI], name: "Ohne Nummer" })
    );
    expect(entscheid).toMatchObject({
      art: "anlegen",
      person: { neu: true, name: "Ohne Nummer" },
      telefon: null,
      status: "no_number",
    });
  });

  it("offene Leads: keiner neu, genau einer wird genommen, mehrere ohne Auswahl legen nichts an", () => {
    expect(entscheideAnrufLead(lage({ personen: [EINS], offeneLeads: [] }))).toMatchObject({
      lead: { neu: true },
    });
    const einer = entscheideAnrufLead(
      lage({ personen: [EINS], offeneLeads: [LEAD_A], wahl: { art: "neu" } })
    );
    expect(einer).toMatchObject({ lead: { neu: false, id: "d1" }, person: { neu: false, id: "p1" } });
    const ohneWahl = entscheideAnrufLead(lage({ personen: [EINS], offeneLeads: [LEAD_A, LEAD_B] }));
    expect(ohneWahl).toMatchObject({ art: "abbruch", grund: "mehrere_leads", leads: [LEAD_A, LEAD_B] });
    const gewaehlt = entscheideAnrufLead(
      lage({ personen: [EINS], offeneLeads: [LEAD_A, LEAD_B], wahl: { art: "bestehend", dealId: "d2" } })
    );
    expect(gewaehlt).toMatchObject({ lead: { neu: false, id: "d2" } });
    const ausdruecklichNeu = entscheideAnrufLead(
      lage({ personen: [EINS], offeneLeads: [LEAD_A, LEAD_B], wahl: { art: "neu" } })
    );
    expect(ausdruecklichNeu).toMatchObject({ lead: { neu: true } });
  });

  it("Status danach bleibt im CHECK, no_number bleibt no_number", () => {
    const erlaubt: AnrufStatus[] = ["matched", "unmatched", "ambiguous", "no_number"];
    for (const status of erlaubt) {
      expect(erlaubt).toContain(statusNachLead(status));
    }
    expect(statusNachLead("unmatched")).toBe("matched");
    expect(statusNachLead("no_number")).toBe("no_number");
    const angelegt = entscheideAnrufLead(lage());
    expect(angelegt.art === "anlegen" && erlaubt.includes(angelegt.status)).toBe(true);
  });

  it("Name: leer, nur Ziffern und zu lang fallen weg", () => {
    expect(leadNameAusDialog(null).ok).toBe(false);
    expect(leadNameAusDialog("  ").ok).toBe(false);
    expect(leadNameAusDialog("A").ok).toBe(false);
    expect(leadNameAusDialog("12345").ok).toBe(false);
    expect(leadNameAusDialog("12 345").ok).toBe(false);
    expect(leadNameAusDialog("+49 151").ok).toBe(false);
    expect(leadNameAusDialog("A".repeat(121)).ok).toBe(false);
    expect(leadNameAusDialog("Ada")).toEqual({ ok: true, name: "Ada" });
    expect(leadNameAusDialog("  Ada   Lovelace ").ok && leadNameAusDialog("  Ada   Lovelace ")).toMatchObject({
      name: "Ada Lovelace",
    });
  });

  it("nur eine beschriftete Zeile wird zum Namensvorschlag", () => {
    expect(nameAusZusammenfassung("Der Kunde heisst Ada Lovelace und zieht um.")).toBeNull();
    expect(nameAusZusammenfassung("Name: Ada Lovelace")).toBe("Ada Lovelace");
    expect(nameAusZusammenfassung("Anrufer: Max")).toBe("Max");
    expect(nameAusZusammenfassung("Kunde: Eva Klein\nName: 1234")).toBe("Eva Klein");
    expect(nameAusZusammenfassung("Name: 12345")).toBeNull();
    expect(nameAusZusammenfassung(null)).toBeNull();
  });

  it("Vor- und Nachname werden getrennt", () => {
    expect(personNameWert("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace" });
    expect(personNameWert("Ada").lastName).toBe("");
    expect(personNameWert("Ada Maria Lovelace").lastName).toBe("Maria Lovelace");
  });

  it("der Knopf gilt nur ohne Lead und nur bei unmatched oder no_number", () => {
    expect(zeigeLeadKnopf("unmatched", null)).toBe(true);
    expect(zeigeLeadKnopf("no_number", null)).toBe(true);
    expect(zeigeLeadKnopf("ambiguous", null)).toBe(false);
    expect(zeigeLeadKnopf("matched", null)).toBe(false);
    expect(zeigeLeadKnopf("unmatched", "d1")).toBe(false);
  });

  it("Sperre hängt an der Nummer, ohne Nummer an der Anruf-Id", () => {
    expect(sperrSchluessel("ws", "+4915112345678", "call-1")).toBe("nummer:ws:+4915112345678");
    expect(sperrSchluessel("ws", null, "call-1")).toBe("anruf:call-1");
  });

  it("offene Stufen folgen den offenen Kategorien, null ist offen", () => {
    expect(istOffeneStufe(null)).toBe(true);
    expect(istOffeneStufe({ title: "Neue Anfrage", stageCategory: "open_new" })).toBe(true);
    expect(istOffeneStufe({ title: "Geplant", stageCategory: "booked" })).toBe(true);
    expect(istOffeneStufe({ title: "Verloren", stageCategory: "lost" })).toBe(false);
    expect(istOffeneStufe({ title: "Bezahlt", stageCategory: null })).toBe(false);
    expect(istOffeneStufe({ title: "Durchgeführt", stageCategory: null })).toBe(false);
    expect(istOffeneStufe({ title: "Irgendwas", stageCategory: null })).toBe(true);
  });

  it("eine schon angehängte Person wird wiederverwendet, wenn die Nummer niemanden trifft", () => {
    const entscheid = entscheideAnrufLead(lage({ angehaengtePersonId: "p-alt", offeneLeads: [LEAD_A] }));
    expect(leadsPersonenId(lage({ angehaengtePersonId: "p-alt" }))).toBe("p-alt");
    expect(entscheid).toMatchObject({ person: { neu: false, id: "p-alt" }, lead: { neu: false, id: "d1" } });
  });

  it("Lead-Service und Webhook legen niemanden von selbst an und schreiben keine Firma", () => {
    const dienst = readFileSync(new URL("../services/phone-call-lead.ts", import.meta.url), "utf8");
    const webhook = readFileSync(new URL("../app/api/webhooks/telefon/route.ts", import.meta.url), "utf8");
    const protokoll = readFileSync(new URL("../services/deal-transcript.ts", import.meta.url), "utf8");
    const verboten = [
      "resolveOrCreatePerson",
      "message.received",
      "createDealForNewConversation",
      "applyDealInsights",
      "extractDealInsights",
      "operating_company",
      "lineLabel",
    ];
    for (const wort of verboten) {
      expect(dienst, wort).not.toContain(wort);
      expect(webhook, wort).not.toContain(wort);
    }
    expect(protokoll).not.toContain("phoneCalls");
    expect(protokoll).not.toContain("phone_calls");
  });
});
