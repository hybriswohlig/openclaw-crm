import { describe, expect, it } from "vitest";
import { lgThemeFor } from "./lg-theme";

describe("lgThemeFor", () => {
  it("maps resolved themes onto the Glassy light and dark tokens", () => {
    expect(lgThemeFor("dark")).toBe("dark");
    expect(lgThemeFor("light")).toBe("light");
    expect(lgThemeFor(undefined)).toBe("light");
  });
});
