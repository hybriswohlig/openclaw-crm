"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlassDock, GlassDockItem } from "@/components/glassyui/glass-dock";
import { HANDY_DOCK, istAktiv } from "./nav-config";
import { NavIcon } from "./seitenleiste";

/** Glas-Dock unten am Handy (unter 1024 px) mit Heute, Leads, Plan, Inbox und Mehr. */
export function HandyDock() {
  const pathname = usePathname();

  return (
    <nav className="neu-handy-dock" aria-label="Hauptnavigation">
      <GlassDock>
        {HANDY_DOCK.map((eintrag) => {
          const aktiv = istAktiv(pathname, eintrag.href);
          return (
            <GlassDockItem key={eintrag.href} asChild active={aktiv} label={eintrag.label}>
              <Link href={eintrag.href} aria-current={aktiv ? "page" : undefined}>
                <NavIcon icon={eintrag.icon} />
              </Link>
            </GlassDockItem>
          );
        })}
      </GlassDock>
    </nav>
  );
}
