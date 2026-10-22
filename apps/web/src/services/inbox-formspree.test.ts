import { describe, expect, it } from "vitest";
import { isFormspreeEmail, parseFormspreeEmail } from "./inbox-formspree";
import { planStructuredEmailLead } from "@/lib/structured-email-lead";

/**
 * Formspree notifications as they arrive at a site mailbox such as
 * info@ceylan-operations.de. English default template and a German field set.
 */

const ENGLISH = `
Hey there,

Someone just submitted your form on https://ceylan-operations.de.

Here's what they had to say:

Name: Elif Demir
Email: elif@example.de
Phone: 0176 1111111
Nachricht: Hallo, wir ziehen am 12.11.2026 von der Hauptstraße 4, 70173 Stuttgart nach München, Gartenweg 2. Bitte um ein Angebot für eine 3-Zimmer-Wohnung.

---
You can view this submission at https://formspree.io/submissions/abc
`;

const GERMAN = `
Neue Nachricht über das Kontaktformular

Vorname: Elif
Nachname: Demir
E-Mail: elif.demir@example.de
Telefon: 0176 1111111
Von: Hauptstraße 4, 70173 Stuttgart
Nach: Gartenweg 2, 80331 München
Umzugsdatum: 12.11.2026
Nachricht: Bitte um ein Angebot für den Umzug und eine Entrümpelung.
`;

describe("Formspree parser", () => {
  it("reads the English Formspree template", () => {
    const lead = parseFormspreeEmail({
      from: "noreply@formspree.io",
      subject: "New submission from ceylan-operations.de",
      body: ENGLISH,
    });
    expect(lead?.customer.fullName).toBe("Elif Demir");
    expect(lead?.customer.email).toBe("elif@example.de");
    expect(lead?.customer.phone).toContain("0176");
    expect(lead?.message).toMatch(/3-Zimmer/);
  });

  it("reads German form labels and a move date", () => {
    const lead = parseFormspreeEmail({
      from: "Formspree <noreply@formspree.io>",
      subject: "Neue Formularnachricht",
      body: GERMAN,
    });
    expect(lead?.customer.fullName).toBe("Elif Demir");
    expect(lead?.customer.email).toBe("elif.demir@example.de");
    expect(lead?.fromLocation?.city).toBe("Stuttgart");
    expect(lead?.toLocation?.city).toBe("München");
    expect(lead?.moveDate).toBe("2026-11-12");
    expect(lead?.message).toMatch(/Entrümpelung/);
  });

  it("falls back to Reply-To when the body has no email", () => {
    const lead = parseFormspreeEmail({
      from: "noreply@formspree.io",
      subject: "New submission",
      body: "Name: Anna Keller\nMessage: Bitte um ein Angebot für einen Umzug von Berlin nach Potsdam.",
      replyTo: "Anna Keller <anna.keller@example.de>",
    });
    expect(lead?.customer.email).toBe("anna.keller@example.de");
    expect(lead?.customer.fullName).toBe("Anna Keller");
  });

  it("ignores mail that is not from Formspree", () => {
    expect(isFormspreeEmail({ from: "anna@example.de", body: "Name: Anna\nE-Mail: anna@example.de" })).toBe(false);
    expect(
      parseFormspreeEmail({ from: "anna@example.de", body: "Name: Anna\nE-Mail: anna@example.de\nNachricht: Umzug" })
    ).toBeNull();
  });

  it("plans one contact per form sender and a website-form deal", () => {
    const plan = planStructuredEmailLead({
      from: "noreply@formspree.io",
      subject: "New submission",
      body: GERMAN,
      messageId: "<form-1@formspree.io>",
    });
    expect(plan?.kind).toBe("formspree");
    expect(plan?.contactEmail).toBe("elif.demir@example.de");
    expect(plan?.sourceChannel).toBe("Website-Formular");
    expect(plan?.threadKey).toContain("elif.demir@example.de");
    expect(plan?.dealName).toMatch(/Elif Demir/);
    expect(plan?.dealName).toMatch(/Stuttgart/);
  });
});
