"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { useInboxUnread } from "@/hooks/use-inbox-unread";
import { useNavZaehler } from "@/hooks/use-nav-zaehler";
import { useSession } from "@/lib/auth-client";
import { useBreit } from "./breit";
import { NAV, istAktiv, type NavEintrag } from "./nav-config";
import { UiUmschalter } from "./ui-umschalter";

/** Linien-Icons aus dem Mockup (03-leads-board.html), 24er-Raster, Strich 1,8. */
const ICON_PFADE: Record<NavEintrag["icon"], React.ReactNode> = {
  heute: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  leads: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M8 4v16M3 10h5" />
    </>
  ),
  plan: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  inbox: <path d="M4 6h16v10H8l-4 4z" />,
  kasse: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  uebersicht: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  kunden: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 8a3 3 0 1 1 0 6" />
    </>
  ),
  anrufe: (
    <path d="M5.5 3.5h3l1.8 4.3-2.2 1.6a12.5 12.5 0 0 0 6.5 6.5l1.6-2.2 4.3 1.8v3a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 3.5 5.6a2 2 0 0 1 2-2.1z" />
  ),
  mitarbeiter: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  bewertungen: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
  einstellungen: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
};

export function NavIcon({ icon }: { icon: NavEintrag["icon"] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PFADE[icon]}
    </svg>
  );
}

/**
 * Glas-Seitenleiste ab 1024 px: Marke, die zwei Gruppen aus NAV, Umschalter zur alten Oberfläche.
 * Zähler: Inbox ungelesen wie bisher; „Heute“ (= Chip „warten auf uns“) und „Leads“ (offene
 * Leads) aus `GET /api/v1/heute/zaehler` (Plan 8, Entscheidung 12), nur wenn die Leiste zu sehen ist.
 * 0 zeigt nichts.
 */
export function Seitenleiste() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const inboxUngelesen = useInboxUnread();
  const sichtbar = useBreit() === true;
  const nav = useNavZaehler(undefined, sichtbar);

  const zaehler: Partial<Record<NonNullable<NavEintrag["zaehler"]>, number>> = {
    inbox: inboxUngelesen,
    heute: nav?.heute,
    leads: nav?.leads,
  };

  return (
    <GlassPanel className="neu-seitenleiste" elevation="raised">
      <div className="neu-marke">
        <div className="neu-marke-zeichen" aria-hidden="true">
          K
        </div>
        <div className="min-w-0">
          <span className="neu-marke-name">Kottke Umzüge</span>
          {session?.user?.name ? <span className="neu-marke-nutzer truncate">{session.user.name}</span> : null}
        </div>
      </div>

      <nav className="neu-nav" aria-label="Hauptnavigation">
        {NAV.map((gruppe) => (
          <div key={gruppe.titel}>
            <h2 className="neu-nav-gruppe">{gruppe.titel}</h2>
            <ul className="neu-nav-liste">
              {gruppe.eintraege.map((eintrag) => {
                const anzahl = eintrag.zaehler ? zaehler[eintrag.zaehler] : undefined;
                return (
                  <li key={eintrag.href}>
                    <Link
                      href={eintrag.href}
                      className="neu-nav-eintrag"
                      aria-current={istAktiv(pathname, eintrag.href) ? "page" : undefined}
                    >
                      <NavIcon icon={eintrag.icon} />
                      {eintrag.label}
                      {anzahl ? <span className="neu-nav-zaehler">{anzahl}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="neu-seitenleiste-fuss">
        <UiUmschalter ziel="alt" className="neu-umschalter" />
      </div>
    </GlassPanel>
  );
}
