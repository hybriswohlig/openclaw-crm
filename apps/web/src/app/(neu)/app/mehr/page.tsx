import type { Metadata } from "next";
import Link from "next/link";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { NAV, seitentitel } from "@/components/neu/nav-config";
import { NavIcon } from "@/components/neu/seitenleiste";
import { UiUmschalter } from "@/components/neu/ui-umschalter";

export const metadata: Metadata = { title: seitentitel("/app/mehr") };

/**
 * Ziel des „Mehr“-Knopfs im Handy-Dock: die Gruppe „Mehr“ aus NAV und der
 * Umschalter zur alten Oberfläche, den es am Handy sonst nirgends gibt
 * (die Seitenleiste erscheint erst ab 1024 px).
 */
export default function MehrPage() {
  const mehr = NAV.find((gruppe) => gruppe.titel === "Mehr")?.eintraege ?? [];
  return (
    <>
      <header className="neu-kopf">
        <h1>{seitentitel("/app/mehr")}</h1>
      </header>
      <GlassPanel className="neu-mehr" elevation="raised">
        <nav aria-label="Mehr">
          <ul className="neu-nav-liste">
            {mehr.map((eintrag) => (
              <li key={eintrag.href}>
                <Link href={eintrag.href} className="neu-nav-eintrag">
                  <NavIcon icon={eintrag.icon} />
                  {eintrag.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="neu-seitenleiste-fuss">
          <UiUmschalter ziel="alt" className="neu-umschalter" />
        </div>
      </GlassPanel>
    </>
  );
}
