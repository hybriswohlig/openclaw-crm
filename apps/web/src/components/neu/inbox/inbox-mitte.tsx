"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GespraechPanel, type GespraechPanelGriff } from "@/components/neu/akte/gespraech-panel";
import { VorlageDialog } from "@/components/neu/akte/vorlage-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { InboxEintrag, Kurzfassung } from "@/lib/inbox-neu";
import type { Gespraech } from "@/services/gespraech";
import { AVATAR_GRAU, SCHNELLAKTION_TEXT, avatarFarbe, gespraechUnterzeile, type Schluessel } from "./inbox-logik";
import type { LaneAktionen } from "./lane-aktionen";
import { Schnellaktionen } from "./schnellaktionen";

/**
 * Die Mitte der Inbox: dasselbe Gespräch-Panel wie in der Akte (Entscheidung 8)
 * mit Name, Unterzeile „{Stufe} · {Quelle} · {Wartet}“ und „Akte öffnen“ im
 * Kopf, Schnellaktionen über dem Antwortfeld, Vorlage-Dialog bei WABA.
 *
 * Am Handy (`kompakt`, Entscheidung 15) als Vollbild: „‹ Inbox“, Kürzel, Name
 * und Unterzeile, Chipzeile „Akte öffnen“, „Fotos anfordern“, „Kein Lead“,
 * darunter das Panel ohne eigenen Kopf und ohne Schnellaktionen.
 */
export function InboxMitte({
  schluessel,
  eintrag,
  gespraech,
  kurz,
  kompakt = false,
  aktionen,
  onNeuLaden,
}: {
  schluessel: Schluessel;
  /** Der Listeneintrag, wenn er in der geladenen Liste steht. */
  eintrag: InboxEintrag | null;
  gespraech: Gespraech;
  kurz: Kurzfassung | null;
  kompakt?: boolean;
  /** Für „Kein Lead“ in der Chipzeile am Handy. */
  aktionen?: LaneAktionen;
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
  /** Vorlagen über direkt verknüpfte WABA-Gespräche, auch ohne Deal (send-template nimmt dealRecordId null, Review I5). */
  const wabaKanaele = gespraech.kanaele.filter((k) => k.istWaba && k.direkt);
  const vorlageOeffnen = wabaKanaele.length > 0 ? () => setVorlage(true) : undefined;
  const einfuegen = (text: string) => griff.current?.einfuegen(text);

  return (
    <>
      {kompakt ? (
        <div className="inbox-handy-kopf">
          <Link href="/app/inbox" className="inbox-zurueck">
            ‹ Inbox
          </Link>
          <div className="inbox-handy-name">
            <span
              className="inbox-avatar"
              style={{ background: eintrag ? avatarFarbe(eintrag.name, eintrag.gruppe) : AVATAR_GRAU }}
              aria-hidden="true"
            >
              {eintrag?.kuerzel ?? "?"}
            </span>
            <div className="inbox-handy-name-text">
              <h1>{name}</h1>
              {unterzeile ? <p>{unterzeile}</p> : null}
            </div>
          </div>
          <div className="inbox-handy-chips">
            {akteLink ? (
              <Link href={akteLink} className="inbox-chip" data-ton="blau">
                Akte öffnen
              </Link>
            ) : null}
            <button type="button" className="inbox-chip" onClick={() => einfuegen(SCHNELLAKTION_TEXT.fotos)}>
              Fotos anfordern
            </button>
            {aktionen && eintrag?.gruppe !== "info" ? (
              <button
                type="button"
                className="inbox-chip"
                onClick={() => void aktionen.keinLead()}
                disabled={aktionen.laeuft || !aktionen.moeglich}
              >
                Kein Lead
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
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
        schnellaktionen={
          kompakt ? undefined : <Schnellaktionen dealId={dealId} kurz={kurz} onEinfuegen={einfuegen} onVorlage={vorlageOeffnen} />
        }
      />
      {vorlage ? (
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
