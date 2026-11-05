import { describe, expect, it } from "vitest";
import { normalizeUiVersion } from "./ui-version";

describe("normalizeUiVersion", () => {
  it("akzeptiert die neue Oberfläche", () => {
    expect(normalizeUiVersion("neu")).toBe("neu");
  });

  it("akzeptiert die alte Oberfläche", () => {
    expect(normalizeUiVersion("alt")).toBe("alt");
  });

  it("lehnt unbekannte Werte ab", () => {
    expect(normalizeUiVersion("v3")).toBeNull();
  });

  it("lehnt fehlende Werte ab", () => {
    expect(normalizeUiVersion(undefined)).toBeNull();
  });
});
