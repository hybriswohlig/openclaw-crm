export function lgThemeFor(resolved: string | undefined): "light" | "dark" {
  return resolved === "dark" ? "dark" : "light";
}
