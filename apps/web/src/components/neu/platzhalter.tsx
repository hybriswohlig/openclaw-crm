import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import { seitentitel } from "./nav-config";

/** Platzhalter für einen Bereich, der erst in einem späteren Meilenstein kommt. */
export function Platzhalter({
  pfad,
  meilenstein,
  alteSeite,
}: {
  pfad: string;
  meilenstein: 1 | 2 | 3;
  alteSeite: string;
}) {
  return (
    <header className="neu-kopf">
      <h1>
        {seitentitel(pfad)}
        <span>Kommt in Meilenstein {meilenstein}</span>
      </h1>
      <div className="neu-kopf-aktion">
        <GlassButton asChild>
          <Link href={alteSeite}>In der alten Oberfläche öffnen</Link>
        </GlassButton>
      </div>
    </header>
  );
}
