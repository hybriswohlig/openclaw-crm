/** Mobile bottom bar. Desktop sidebar is a separate list and stays as it is. */

export interface MobileNavItem {
  href: string;
  label: string;
  /** Inbox unread count. Only the Inbox tab shows it. */
  showBadge?: boolean;
}

export const mobilePrimaryTabs: readonly MobileNavItem[] = [
  { href: "/home", label: "Heute" },
  { href: "/operations", label: "Aufträge" },
  { href: "/inbox", label: "Inbox", showBadge: true },
  { href: "/contract-calendar", label: "Kalender" },
];

export const mobileMehrItems: readonly MobileNavItem[] = [
  { href: "/email", label: "E-Mail" },
  { href: "/tasks", label: "Aufgaben" },
  { href: "/objects/deals", label: "Leads" },
  { href: "/notes", label: "Notizen" },
  { href: "/notifications", label: "Benachrichtigungen" },
  { href: "/objects/people", label: "Kunden" },
  { href: "/objects/companies", label: "Firmen" },
  { href: "/employees", label: "Mitarbeiter" },
  { href: "/financial", label: "Finanzen" },
  { href: "/integrations", label: "Integrationen" },
  { href: "/settings", label: "Einstellungen" },
  { href: "/anrufe", label: "Anrufe" },
];

/** Same rule as the primary tabs: exact path or a nested record. */
export function isMobileNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when the open page lives in Mehr, so the Mehr tab can show as current. */
export function mobileMehrContains(pathname: string): boolean {
  return mobileMehrItems.some((item) => isMobileNavActive(pathname, item.href));
}
