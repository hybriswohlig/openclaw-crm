import { expect, it } from "vitest";
import { brandingForOperatingCompany } from "@openclaw-crm/customer-portal-core";

it("gibt Kottke Logo, Orange und Dario als Ansprechpartner", () => {
  const b = brandingForOperatingCompany("Kottke-Umzüge");
  expect(b.primaryColor).toBe("c2570c");
  expect(b.logoUrl).toBe("/branding/kottke/logo.svg");
  expect(b.ansprechpartner?.name).toBe("Dario Kottke");
  expect(b.ansprechpartner?.rolle).toBe("Inhaber");
  expect(b.ansprechpartner?.fotoUrl).toBe("/branding/kottke/dario-160.jpg");
  expect(b.ansprechpartner?.unterschriftUrl).toBe("/branding/kottke/unterschrift-dario.png");
});

it("lässt Ceylan und unbekannte Firmen ohne Ansprechpartner", () => {
  expect(brandingForOperatingCompany("Ceylan Operations").ansprechpartner).toBeNull();
  expect(brandingForOperatingCompany(null).ansprechpartner).toBeNull();
  expect(brandingForOperatingCompany("Irgendwer GmbH").ansprechpartner).toBeNull();
});
