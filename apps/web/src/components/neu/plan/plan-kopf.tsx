"use client";

import type { ReactNode } from "react";

/**
 * Kopf des Plans (Mockup 04, Entscheidung 20): „Plan“, zweite Zeile, Meta
 * zum Ziehen (am Handy ohne, dort wird nicht gezogen), rechts „+ Termin“.
 */
export function PlanKopf({ kompakt, aktion }: { kompakt: boolean; aktion?: ReactNode }) {
  return (
    <header className="neu-kopf plan-kopf">
      <div className="plan-kopf-text">
        <h1>Plan</h1>
        <p className="neu-kopf-zweite">Umzüge und Besichtigungen, Tag für Tag.</p>
        {kompakt ? null : (
          <p className="plan-meta">Zieh einen Umzug auf einen anderen Tag. Das CRM fragt vorher; der Kunde erfährt es erst, wenn du ihm schreibst.</p>
        )}
      </div>
      {aktion ? <div className="plan-kopf-aktionen">{aktion}</div> : null}
    </header>
  );
}
