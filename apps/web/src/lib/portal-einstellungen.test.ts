import { expect, it } from "vitest";
import { standardPlatzhalter } from "./portal-einstellungen";

it("zeigt im leeren Feld, was ohne Eintrag gilt", () => {
  expect(standardPlatzhalter("Kottke-Umzüge")).toEqual({ farbe: "c2570c (Standard)", logo: "leer: Logo je Leistung (Umzug, Entrümpelung, Küche)" });
  expect(standardPlatzhalter("Ceylan Operations")).toEqual({ farbe: "ea580c (Standard)", logo: "https://…/logo.png" });
});
