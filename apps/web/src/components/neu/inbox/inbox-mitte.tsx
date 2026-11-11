"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GespraechPanel, type GespraechPanelGriff } from "@/components/neu/akte/gespraech-panel";
import { VorlageDialog } from "@/components/neu/akte/vorlage-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { textKopieren } from "@/components/neu/kv-danach/status-link";
import type { VerfassenVorgabe } from "@/lib/handy-links";
import type { InboxEintrag, Kurzfassung } from "@/lib/inbox-neu";
import type { Gespraech } from "@/services/gespraech";
import { AVATAR_GRAU, SCHNELLAKTION_TEXT, avatarFarbe, gespraechUnterzeile, type Schluessel } from "./inbox-logik";
import type { LaneAktionen } from "./lane-aktionen";
import { fensterZu } from "@/components/neu/akte/gespraech-texte";
import { kvNachrichtWeg, type KvWeg } from "./kv-nachricht";
import { Schnellaktionen } from "./schnellaktionen";

/** „Im Chat senden“ nach dem KV (kv-danach): Auftrag an die Mitte dieses Deals. */
export interface KvAuftrag {
  onErledigt: () => void;
  /** Kein Gespräch: das WhatsApp-Verfassen mit dem vorbereiteten Text öffnen. */
  onVerfassen: (vorgabe: VerfassenVorgabe, text: string) => void;
}

/**
 * Die Mitte der Inbox: dasselbe Gespräch-Panel wie in der Akte (Entscheidung 8)
 * mit Name, Unterzeile „{Stufe} · {Quelle} · {Wartet}“ und „Akte öffnen“ im
 * Kopf, Schnellaktionen über dem Antwortfeld, Vorlage-Dialog bei WABA.
 *
 * Am Handy (`kompakt`, Entscheidung 15) als Vollbild: „‹ Inbox“, Kürzel, Name
 * und Unterzeile, Chipzeile „Akte öffnen“, „Fotos anfordern“, „Kein Lead“,
 * darunter das Panel ohne eigenen Kopf und ohne Schnellaktionen.
 *
 * `kv` (kv-danach): nach „Im Chat senden“ den Kurztext zum KV einmal
 * vorbereiten und ins Eingabefeld legen, nie senden. Ohne Gespräch öffnet die
 * Seite das WhatsApp-Verfassen mit dem Text; bei WABA außerhalb des Fensters
 * ein Hinweis auf die Vorlage wie im gesperrten Eingabefeld.
 */
export function InboxMitte({
  schluessel,
  eintrag,
  gespraech,
  kurz,
  kompakt = false,
  aktionen,
  onNeuLaden,
  kv,
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
  kv?: KvAuftrag;
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

  // ── Kurztext nach dem KV (kv-danach), einmal je Auftrag ──
  // Der Auftrag (`kv`) ist in der Seite gemerkt und fällt nach `onErledigt` weg; ein neuer
  // „Im Chat senden“ setzt ihn neu. Beim Wechsel des Gesprächs wird ein laufender Auftrag
  // verworfen (kein Verfassen-Fenster für den vorigen Deal).
  const stand = useRef({ kurz, gespraech, onNeuLaden, vorlageOeffnen });
  stand.current = { kurz, gespraech, onNeuLaden, vorlageOeffnen };
  useEffect(() => {
    if (!kv || !dealId) return;
    let verworfen = false;
    const { onErledigt, onVerfassen } = kv;
    // Kopieren nur per Knopf im Hinweis: dort ist es eine Nutzergeste, die Zwischenablage nimmt es an.
    const kopierKnopf = (text: string) => ({
      label: "Text kopieren",
      onClick: () => void textKopieren(Promise.resolve(text)).then((ok) => (ok ? toast.success("Text kopiert.") : toast.error("Kopieren ging nicht."))),
    });

    const insFeld = (text: string, zu: boolean, gespraechId: string) => {
      // Erst den Kanal wählen, auf den sich Text und Hinweis beziehen (Review M3).
      griff.current?.waehlen(gespraechId);
      griff.current?.einfuegen(text);
      if (!zu) {
        toast.success("Nachricht vorbereitet.", { description: "Sie steht im Eingabefeld. Gesendet wird erst mit deinem Klick." });
        return;
      }
      // Wie das gesperrte Eingabefeld: freier Text erst nach einer Antwort des Kunden.
      const vorlage = stand.current.vorlageOeffnen;
      toast.warning("24-Stunden-Fenster zu.", {
        description: "Bitte zuerst eine Vorlage senden. Den vorbereiteten Text kannst du kopieren und nach der Antwort senden.",
        action: vorlage ? { label: "Vorlage", onClick: vorlage } : undefined,
        cancel: kopierKnopf(text),
        duration: 20_000,
      });
    };

    const ausfuehren = async (weg: KvWeg) => {
      if (weg.art === "einfuegen") return insFeld(weg.text, weg.fensterZu, weg.gespraechId);
      if (weg.art === "verfassen") return onVerfassen(weg.vorgabe, weg.text);
      if (weg.art === "neu_laden") {
        const frisch = await stand.current.onNeuLaden();
        if (verworfen) return;
        const k = frisch?.kanaele.find((x) => x.gespraechId === weg.gespraechId && x.kannSenden);
        if (k) return insFeld(weg.text, fensterZu(k), k.gespraechId);
        toast.message("Das WhatsApp-Gespräch hängt an einem anderen Deal.", { cancel: kopierKnopf(weg.text), duration: 20_000 });
        return;
      }
      const ziel = weg.ziel;
      toast.error(weg.titel, {
        description: weg.text,
        action: ziel ? { label: ziel.label, onClick: () => window.location.assign(ziel.href) } : undefined,
        // Fehlt nur das Gespräch, ist der Text trotzdem fertig.
        cancel: weg.nachricht ? kopierKnopf(weg.nachricht) : undefined,
        duration: weg.nachricht ? 20_000 : 12_000,
      });
    };

    void kvNachrichtWeg(dealId, stand.current.kurz, stand.current.gespraech)
      .then((weg) => (verworfen ? undefined : ausfuehren(weg)))
      .catch(() => {
        if (!verworfen) toast.error("Nachricht konnte nicht vorbereitet werden.");
      })
      .finally(() => {
        if (!verworfen) onErledigt();
      });
    return () => {
      verworfen = true;
    };
  }, [kv, dealId]);

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
