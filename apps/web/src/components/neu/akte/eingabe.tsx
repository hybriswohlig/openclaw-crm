"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useEffect, useId, useState, type RefObject } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { GespraechKanal } from "@/services/gespraech";
import { apiAufruf, jsonAufruf } from "./api";
import { KANAL_LABEL } from "./gespraech-verlauf";

/** Fehlertext je Code der Senderoute; sonst „Senden fehlgeschlagen.“ */
export function sendeFehler(code: string | null, meldung: string): string {
  switch (code) {
    case "WA_SESSION_EXPIRED":
      return "24-Stunden-Fenster zu.";
    case "BAILEYS_BRIDGE_NOT_CONFIGURED":
      return "WhatsApp ist für diese Nummer nicht verbunden.";
    case "BAILEYS_BRIDGE_ERROR":
      return "WhatsApp hat nicht geantwortet. Bitte erneut senden.";
    default:
      return meldung.trim() !== "" ? `Senden fehlgeschlagen. ${meldung}` : "Senden fehlgeschlagen.";
  }
}

/** Antwort von `POST …/suggest-reply`: kein `{data}`-Umschlag. */
interface Vorschlag {
  text?: string | null;
  reason?: string;
  error?: string;
}

/** WABA außerhalb des 24-Stunden-Fensters: nur eine Vorlage geht noch. */
export function fensterZu(k: GespraechKanal | undefined): boolean {
  return Boolean(k && k.istWaba && k.imFenster === false);
}

/**
 * Das Eingabefeld über dem Dock: Kanalpunkt als Wahl des sendefähigen
 * Gesprächs (Entscheidung 11), Textfeld, „KI-Entwurf“ und Senden-Kreis.
 * Ohne sendefähiges Gespräch gesperrt mit „WhatsApp starten“; bei WABA
 * außerhalb des Fensters gesperrt mit Sprung zur Vorlage in der alten Inbox.
 */
export function Eingabe({
  dealId,
  kanaele,
  gewaehltId,
  onWaehlen,
  kundeName,
  text,
  onText,
  feldRef,
  onGesendet,
}: {
  dealId: string;
  kanaele: GespraechKanal[];
  gewaehltId: string | null;
  onWaehlen: (id: string) => void;
  kundeName: string;
  text: string;
  onText: (text: string) => void;
  feldRef: RefObject<HTMLTextAreaElement | null>;
  onGesendet: () => Promise<void> | void;
}) {
  const portalZiel = usePortalZiel();
  const feldId = useId();
  const [sendet, setSendet] = useState(false);
  const [entwirft, setEntwirft] = useState(false);
  const [startet, setStartet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [menueOffen, setMenueOffen] = useState(false);

  const sendbar = kanaele.filter((k) => k.kannSenden);
  const gewaehlt = sendbar.find((k) => k.gespraechId === gewaehltId);

  // Das Feld wächst mit dem Text bis zur Höchsthöhe aus dem Stylesheet.
  useEffect(() => {
    const el = feldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, feldRef]);

  async function senden() {
    const body = text.trim();
    if (!gewaehlt || body === "" || sendet) return;
    setSendet(true);
    setFehler(null);
    setHinweis(null);
    const r = await apiAufruf<unknown>(
      `/api/v1/inbox/conversations/${gewaehlt.gespraechId}/messages`,
      jsonAufruf("POST", { body })
    );
    setSendet(false);
    if (!r.ok) {
      setFehler(sendeFehler(r.code, r.message));
      return;
    }
    onText("");
    await onGesendet();
    feldRef.current?.focus();
  }

  async function kiEntwurf() {
    if (!gewaehlt || entwirft) return;
    setEntwirft(true);
    setFehler(null);
    setHinweis(null);
    let j: Vorschlag | null;
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${gewaehlt.gespraechId}/suggest-reply`, { method: "POST" });
      j = (await res.json().catch(() => null)) as Vorschlag | null;
    } catch {
      j = null;
    }
    setEntwirft(false);
    if (j?.text && j.text.trim() !== "") {
      onText(j.text.trim());
      feldRef.current?.focus();
      return;
    }
    const grund = j?.reason ?? j?.error;
    setHinweis(grund ? `Kein Entwurf möglich. ${grund}` : "Kein Entwurf möglich.");
  }

  async function whatsappStarten() {
    if (startet) return;
    setStartet(true);
    const r = await apiAufruf<unknown>("/api/v1/inbox/whatsapp/start-from-record", jsonAufruf("POST", { recordId: dealId }));
    setStartet(false);
    if (!r.ok) {
      toast.error("WhatsApp konnte nicht gestartet werden.", { description: r.message });
      return;
    }
    toast.success("WhatsApp-Gespräch angelegt.");
    await onGesendet();
  }

  if (sendbar.length === 0) {
    return (
      <div className="akte-gespraech-eingabe" data-gesperrt="">
        <span className="akte-gespraech-gesperrt">Noch kein Kanal mit diesem Kunden.</span>
        <GlassButton size="sm" onClick={() => void whatsappStarten()} disabled={startet}>
          {startet ? "Startet…" : "WhatsApp starten"}
        </GlassButton>
      </div>
    );
  }

  const kanalWahl = (
    <KanalWahl
      sendbar={sendbar}
      gewaehlt={gewaehlt}
      offen={menueOffen}
      onOffen={setMenueOffen}
      onWaehlen={(id) => {
        setFehler(null);
        setHinweis(null);
        onWaehlen(id);
      }}
      portalZiel={portalZiel}
    />
  );

  if (fensterZu(gewaehlt)) {
    return (
      <div className="akte-gespraech-eingabe" data-gesperrt="">
        {kanalWahl}
        <span className="akte-gespraech-gesperrt">
          24-Stunden-Fenster zu. Bitte eine Vorlage senden.{" "}
          <a className="akte-gespraech-sprung" href={`/inbox?conv=${encodeURIComponent(gewaehlt!.gespraechId)}`}>
            Vorlage
          </a>
        </span>
      </div>
    );
  }

  const name = gewaehlt?.kundeName?.trim() || kundeName;

  return (
    <>
      <div className="akte-gespraech-eingabe">
        {kanalWahl}
        <label className="sr-only" htmlFor={feldId}>
          Nachricht an {name}
        </label>
        <textarea
          id={feldId}
          ref={feldRef}
          className="akte-gespraech-feld"
          rows={1}
          placeholder={`Nachricht an ${name}…`}
          value={text}
          disabled={sendet || !gewaehlt}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            // Touch-Tastaturen: Enter macht eine neue Zeile. Sonst sendet Enter, Umschalt+Enter bricht um.
            const touch = typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;
            if (!touch && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void senden();
            }
          }}
        />
        <button
          type="button"
          className="akte-gespraech-ki"
          onClick={() => void kiEntwurf()}
          disabled={entwirft || sendet || !gewaehlt}
        >
          {entwirft ? "Entwurf…" : "KI-Entwurf"}
        </button>
        <button
          type="button"
          className="akte-gespraech-senden"
          onClick={() => void senden()}
          disabled={sendet || !gewaehlt || text.trim() === ""}
          data-sendet={sendet || undefined}
          aria-label={sendet ? "Wird gesendet" : "Senden"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
      {fehler ? (
        <p className="akte-gespraech-fehler" role="alert">
          {fehler}
        </p>
      ) : null}
      {hinweis ? (
        <p className="akte-gespraech-hinweis" role="status">
          {hinweis}
        </p>
      ) : null}
    </>
  );
}

/**
 * Der Kanalpunkt: bei mehreren sendefähigen Gesprächen ein Menü, sonst nur
 * der Punkt mit Beschriftung.
 */
function KanalWahl({
  sendbar,
  gewaehlt,
  offen,
  onOffen,
  onWaehlen,
  portalZiel,
}: {
  sendbar: GespraechKanal[];
  gewaehlt: GespraechKanal | undefined;
  offen: boolean;
  onOffen: (offen: boolean) => void;
  onWaehlen: (id: string) => void;
  portalZiel: HTMLElement | undefined;
}) {
  const label = gewaehlt ? `${KANAL_LABEL[gewaehlt.kanal]} · ${gewaehlt.name}` : "Kein Kanal";

  if (sendbar.length < 2) {
    return (
      <span className="akte-gespraech-kanalknopf" data-fest="" title={label} aria-label={`Kanal: ${label}`} role="img">
        <i className="akte-gespraech-punkt" data-kanal={gewaehlt?.kanal} aria-hidden="true" />
      </span>
    );
  }

  return (
    <Menu.Root open={offen} onOpenChange={onOffen} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="akte-gespraech-kanalknopf" title={label} aria-label={`Kanal: ${label}, ändern`}>
          <i className="akte-gespraech-punkt" data-kanal={gewaehlt?.kanal} aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalZiel}>
        <Menu.Content asChild align="start" side="top" sideOffset={8} collisionPadding={12}>
          <GlassPanel
            elevation="raised"
            lens
            preset="prominent"
            refraction="none"
            variant="card"
            className="lg-menu-content akte-gespraech-menue"
          >
            <Menu.Label className="lg-menu-label">Kanal</Menu.Label>
            {sendbar.map((k) => {
              const aktuell = k.gespraechId === gewaehlt?.gespraechId;
              return (
                <Menu.Item
                  key={k.gespraechId}
                  className="lg-menu-item akte-gespraech-menue-eintrag"
                  data-aktuell={aktuell || undefined}
                  aria-current={aktuell ? "true" : undefined}
                  onSelect={() => onWaehlen(k.gespraechId)}
                >
                  <i className="akte-gespraech-punkt" data-kanal={k.kanal} aria-hidden="true" />
                  <span>
                    {KANAL_LABEL[k.kanal]} · {k.name}
                  </span>
                  {fensterZu(k) ? <small>Fenster zu</small> : null}
                </Menu.Item>
              );
            })}
          </GlassPanel>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
