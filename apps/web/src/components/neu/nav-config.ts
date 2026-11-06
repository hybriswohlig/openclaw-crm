/**
 * Die eine Navigationsdefinition der neuen Oberfläche. Seitenleiste, Handy-Dock und
 * Seitentitel lesen alle hieraus, damit es keine zweite Liste gibt, die auseinanderläuft.
 */

export interface NavEintrag {
  href: string;
  label: string;
  icon:
    | "heute"
    | "leads"
    | "plan"
    | "inbox"
    | "kasse"
    | "uebersicht"
    | "kunden"
    | "anrufe"
    | "mitarbeiter"
    | "bewertungen"
    | "einstellungen";
  /** Welcher Zähler rechts neben dem Eintrag stehen darf, wenn eine API ihn liefert. */
  zaehler?: "heute" | "leads" | "inbox" | "kasse";
}

const HEUTE: NavEintrag = { href: "/app/heute", label: "Heute", icon: "heute", zaehler: "heute" };
const LEADS: NavEintrag = { href: "/app/leads", label: "Leads", icon: "leads", zaehler: "leads" };
const PLAN: NavEintrag = { href: "/app/plan", label: "Plan", icon: "plan" };
const INBOX: NavEintrag = { href: "/app/inbox", label: "Inbox", icon: "inbox", zaehler: "inbox" };
const KASSE: NavEintrag = { href: "/app/kasse", label: "Kasse", icon: "kasse", zaehler: "kasse" };

export const NAV: ReadonlyArray<{ titel: "Arbeit" | "Mehr"; eintraege: readonly NavEintrag[] }> = [
  { titel: "Arbeit", eintraege: [HEUTE, LEADS, PLAN, INBOX, KASSE] },
  {
    titel: "Mehr",
    eintraege: [
      { href: "/app/uebersicht", label: "Übersicht", icon: "uebersicht" },
      { href: "/app/kunden", label: "Kunden", icon: "kunden" },
      { href: "/app/anrufe", label: "Anrufe", icon: "anrufe" },
      { href: "/app/mitarbeiter", label: "Mitarbeiter", icon: "mitarbeiter" },
      { href: "/app/bewertungen", label: "Bewertungen", icon: "bewertungen" },
      { href: "/app/einstellungen", label: "Einstellungen", icon: "einstellungen" },
    ],
  },
];

export const HANDY_DOCK: readonly NavEintrag[] = [
  HEUTE,
  LEADS,
  PLAN,
  INBOX,
  { href: "/app/mehr", label: "Mehr", icon: "uebersicht" },
];

/** Aktiv auf dem Pfad selbst und auf allen Unterseiten, nicht auf Pfaden mit gleichem Anfang. */
export function istAktiv(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Label des aktiven Eintrags (Seitenleiste, dann Handy-Dock wie „Mehr“); sonst schlicht „CRM“. */
export function seitentitel(pathname: string): string {
  for (const eintraege of [...NAV.map((gruppe) => gruppe.eintraege), HANDY_DOCK]) {
    const treffer = eintraege.find((e) => istAktiv(pathname, e.href));
    if (treffer) return treffer.label;
  }
  return "CRM";
}
