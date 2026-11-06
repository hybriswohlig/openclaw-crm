"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GespraechPanel, type GespraechPanelGriff } from "@/components/neu/akte/gespraech-panel";
import { VorlageDialog } from "@/components/neu/akte/vorlage-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { InboxEintrag, Kurzfassung } from "@/lib/inbox-neu";
import type { Gespraech } from "@/services/gespraech";
import { gespraechUnterzeile, type Schluessel } from "./inbox-logik";
import { Schnellaktionen } from "./schnellaktionen";

/**
 * Die Mitte der Inbox: dasselbe Gespräch-Panel wie in der Akte (Entscheidung 8)
 * mit Name, Unterzeile „{Stufe} · {Quelle} · {Wartet}“ und „Akte öffnen“ im
 * Kopf, Schnellaktionen über dem Antwortfeld, Vorlage-Dialog bei WABA.
 */
export function InboxMitte({
  schluessel,
  eintrag,
  gespraech,
  kurz,
  onNeuLaden,
}: {
  schluessel: Schluessel;
  /** Der Listeneintrag, wenn er in der geladenen Liste steht. */
  eintrag: InboxEintrag | null;
  gespraech: Gespraech;
  kurz: Kurzfassung | null;
  onNeuLaden: () => Promise<Gespraech | null>;
}) {
  const griff = useRef<GespraechPanelGriff>(null);
  const [vorlage, setVorlage] = useState(false);
  const portalZiel = usePortalZiel();

  const dealId = schluessel.art === "deal" ? schluessel.id : null;
  const name =
    eintrag?.name ?? kurz?.name ?? gespraech.kanaele.find((k) => k.kundeName?.trim())?.kundeName?.trim() ?? "Gespräch";
  const unterzeile = gespraechUnterzeile(eintrag, kurz);
  const akteLink = dealId ? (kurz?.akteLink ?? `/app/leads/${dealId}`) : null;
  /** Vorlagen nur über direkt verknüpfte WABA-Gespräche des Deals (wie die Akte). */
  const wabaKanaele = dealId ? gespraech.kanaele.filter((k) => k.istWaba && k.direkt) : [];
  const vorlageOeffnen = wabaKanaele.length > 0 ? () => setVorlage(true) : undefined;
  const einfuegen = (text: string) => griff.current?.einfuegen(text);

  return (
    <>
      <GespraechPanel
        griff={griff}
        dealId={dealId}
        gespraech={gespraech}
        kundeName={name}
        onNeuLaden={onNeuLaden}
        onVorlage={vorlageOeffnen}
        titel={name}
        unterzeile={unterzeile}
        kopfRechts={
          akteLink ? (
            <GlassButton size="sm" variant="ghost" asChild>
              <Link href={akteLink}>Akte öffnen</Link>
            </GlassButton>
          ) : undefined
        }
        ohneAnsichten
        ohneDock
        schnellaktionen={<Schnellaktionen dealId={dealId} kurz={kurz} onEinfuegen={einfuegen} onVorlage={vorlageOeffnen} />}
      />
      {vorlage && dealId ? (
        <VorlageDialog
          dealId={dealId}
          kanaele={wabaKanaele}
          portalZiel={portalZiel}
          onSchliessen={() => setVorlage(false)}
          onNeuLaden={async () => {
            await onNeuLaden();
          }}
        />
      ) : null}
    </>
  );
}
