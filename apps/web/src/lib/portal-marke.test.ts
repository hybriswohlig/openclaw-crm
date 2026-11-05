import { expect, it } from "vitest";
import { CEYLAN_BRANDING, KOTTKE_BRANDING, brandingForOperatingCompany, logoFuer } from "@openclaw-crm/customer-portal-core";

it("gibt Kottke Logo, Orange und Dario als Ansprechpartner", () => {
  const b = brandingForOperatingCompany("Kottke-Umzüge");
  expect(b.primaryColor).toBe("c2570c");
  expect(b.logoUrl).toBe("/branding/kottke/logo.png");
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

it("wählt das Kottke-Logo nach der Leistung, ohne Leistung das Grundlogo", () => {
  expect(logoFuer(KOTTKE_BRANDING, "move")).toBe("/branding/kottke/logo-umzuege.png");
  expect(logoFuer(KOTTKE_BRANDING, "clearance")).toBe("/branding/kottke/logo-entruempelung.png");
  expect(logoFuer(KOTTKE_BRANDING, "kitchen_installation")).toBe("/branding/kottke/logo-kuechen.png");
  expect(logoFuer(KOTTKE_BRANDING, null)).toBe("/branding/kottke/logo.png");
});

it("ohne Logos je Leistung gilt das eine Logo der Firma", () => {
  expect(logoFuer(CEYLAN_BRANDING, "move")).toBeNull();
  expect(logoFuer({ ...KOTTKE_BRANDING, logoUrl: "https://example.invalid/eigen.png", logoJeLeistung: null }, "move")).toBe(
    "https://example.invalid/eigen.png",
  );
});
