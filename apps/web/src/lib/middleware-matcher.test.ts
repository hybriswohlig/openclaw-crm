import { expect, it } from "vitest";
import { config } from "../middleware";

// Next wendet den Matcher auf den ganzen Pfad an; als RegExp nachgebildet.
const greift = (pfad: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(pfad));

it("lässt statische Dateien ohne Sitzungsprüfung durch, auch Schriften", () => {
  expect(greift("/fonts/portal/plus-jakarta-sans-latin.woff2")).toBe(false);
  expect(greift("/branding/kottke/logo.svg")).toBe(false);
  expect(greift("/branding/kottke/dario-160.jpg")).toBe(false);
});

it("prüft Portal- und CRM-Seiten weiter", () => {
  expect(greift("/s/abc123")).toBe(true);
  expect(greift("/login")).toBe(true);
  expect(greift("/fonts/portal/OFL.txt")).toBe(true);
});
