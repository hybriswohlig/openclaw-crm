/** Kundenseiten: hier läuft kein Drittanbieter-Tracking (Token in der URL, § 25 TDDDG). */
export function istPortalPfad(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/s/") || pathname.startsWith("/legal/");
}
