"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { Gespraech, GespraechKanal } from "@/services/gespraech";
import { apiAufruf, jsonAufruf } from "./api";
import { fensterZu, nachStart, posteingangUrl, sendeFehler, startFolge } from "./gespraech-texte";
import { KANAL_LABEL } from "./gespraech-verlauf";

export { fensterZu, sendeFehler };

/** Antwort von `POST …/suggest-reply`: kein `{data}`-Umschlag. */
interface Vorschlag {
  text?: string | null;
  reason?: string;
  error?: string;
}

/** Hinweis unter dem Feld, wahlweise mit Sprung in die alte Inbox. */
interface Hinweis {
  text: string;
  link?: { url: string; text: string };
}

/**
 * Das Eingabefeld über dem Dock: Kanalpunkt als Wahl des sendefähigen
 * Gesprächs (Entscheidung 11), Textfeld, „KI-Entwurf“ und Senden-Kreis.
 * Ohne sendefähiges Gespräch gesperrt mit „WhatsApp starten“; bei WABA
 * außerhalb des Fensters gesperrt mit „Vorlage“: öffnet den Vorlage-Dialog der
 * Akte (`onVorlage`, Task 14), ohne ihn der Sprung in die alte Inbox.
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
  onVorlage,
}: {
  dealId: string;
  kanaele: GespraechKanal[];
  gewaehltId: string | null;
  onWaehlen: (id: string) => void;
  kundeName: string;
  text: string;
  onText: (text: string) => void;
  feldRef: RefObject<HTMLTextAreaElement | null>;
  /** Lädt die Akte neu und liefert das frische Gespräch (null, wenn das Laden scheitert). */
  onGesendet: () => Promise<Gespraech | null>;
  /** Öffnet den Vorlage-Dialog der Akte; ohne Rückruf führt „Vorlage“ in die alte Inbox. */
  onVorlage?: () => void;
}) {
  const router = useRouter();
  const portalZiel = usePortalZiel();
  const feldId = useId();
  const [sendet, setSendet] = useState(false);
  const [entwirft, setEntwirft] = useState(false);
  const [startet, setStartet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<Hinweis | null>(null);
  const [menueOffen, setMenueOffen] = useState(false);
  // Doppelklick oder Enter während eines laufenden Sendens darf nicht zweimal senden.
  const sendetRef = useRef(false);

  const sendbar = kanaele.filter((k) => k.kannSenden);
  const gewaehlt = sendbar.find((k) => k.gespraechId === gewaehltId);

  // Sobald das gewählte Gespräch sendefähig ist, hat ein Hinweis mit Sprung in die alte Inbox nichts mehr zu sagen.
  const gewaehltSendbar = gewaehlt?.gespraechId ?? null;
  useEffect(() => {
    if (gewaehltSendbar) setHinweis((h) => (h?.link ? null : h));
  }, [gewaehltSendbar]);

  // Das Feld wächst mit dem Text bis zur Höchsthöhe aus dem Stylesheet.
  useEffect(() => {
    const el = feldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, feldRef]);

  async function senden() {
    const body = text.trim();
    if (!gewaehlt || body === "" || sendetRef.current) return;
    sendetRef.current = true;
    setSendet(true);
    setFehler(null);
    setHinweis(null);
    try {
      const r = await apiAufruf<unknown>(
        `/api/v1/inbox/conversations/${gewaehlt.gespraechId}/messages`,
        jsonAufruf("POST", { body })
      );
      if (!r.ok) {
        setFehler(sendeFehler(r.code, r.message));
        // Das Fenster ist zu: die Akte neu laden, damit die Sperre sofort erscheint.
        if (r.code === "WA_SESSION_EXPIRED") await onGesendet();
        return;
      }
      onText("");
      await onGesendet();
    } finally {
      sendetRef.current = false;
      setSendet(false);
      window.requestAnimationFrame(() => feldRef.current?.focus());
    }
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
    setHinweis({ text: grund ? `Kein Entwurf möglich. ${grund}` : "Kein Entwurf möglich." });
  }

  /**
   * `start-from-record` antwortet `compose` (noch kein Gespräch: Verfassen in
   * der alten Inbox) oder `open` (Gespräch gibt es, meist jetzt am Deal: Akte
   * neu laden). Entschieden wird aus dem frisch geladenen Gespräch, das
   * `onGesendet` zurückgibt, nicht aus den Props dieses Renders. Ist es danach
   * nicht sendefähig (anderer Deal), bleibt nur der Sprung in den Posteingang.
   */
  async function whatsappStarten() {
    if (startet) return;
    setStartet(true);
    setFehler(null);
    setHinweis(null);
    const r = await apiAufruf<unknown>("/api/v1/inbox/whatsapp/start-from-record", jsonAufruf("POST", { recordId: dealId }));
    if (!r.ok) {
      setStartet(false);
      setFehler(`WhatsApp konnte nicht gestartet werden. ${r.message}`);
      return;
    }
    const folge = startFolge(r.data);
    if (folge.art === "verfassen") {
      // Der Knopf bleibt gesperrt, bis die alte Inbox geladen ist.
      router.push(folge.url);
      return;
    }
    if (folge.art === "neu_laden") {
      const frisch = await onGesendet();
      setStartet(false);
      if (!frisch) {
        // Das Neuladen hat schon einen Toast gezeigt; hier nur der Weg zum Gespräch.
        setHinweis({
          text: "Die Akte konnte nicht neu geladen werden.",
          link: { url: posteingangUrl(folge.conversationId), text: "Im Posteingang öffnen" },
        });
        return;
      }
      const e = nachStart(frisch.kanaele, folge.conversationId);
      if (e.art === "waehlen") {
        onWaehlen(e.gespraechId);
        return;
      }
      setHinweis({ text: e.text, link: e.link });
      return;
    }
    setStartet(false);
    setFehler("WhatsApp konnte nicht gestartet werden. Unerwartete Antwort des Servers.");
  }

  const meldungen = (
    <>
      {fehler ? (
        <p className="akte-gespraech-fehler" role="alert">
          {fehler}
        </p>
      ) : null}
      {hinweis ? (
        <p className="akte-gespraech-hinweis" role="status">
          {hinweis.text}
          {hinweis.link ? (
            <>
              {" "}
              <a className="akte-gespraech-sprung" href={hinweis.link.url}>
                {hinweis.link.text}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );

  if (sendbar.length === 0) {
    return (
      <>
        <div className="akte-gespraech-eingabe" data-gesperrt="">
          <span className="akte-gespraech-gesperrt">Noch kein Kanal mit diesem Kunden.</span>
          <GlassButton size="sm" onClick={() => void whatsappStarten()} disabled={startet}>
            {startet ? "Startet…" : "WhatsApp starten"}
          </GlassButton>
        </div>
        {meldungen}
      </>
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
      <>
        <div className="akte-gespraech-eingabe" data-gesperrt="">
          {kanalWahl}
          <span className="akte-gespraech-gesperrt">
            24-Stunden-Fenster zu. Bitte eine Vorlage senden.{" "}
            {onVorlage ? (
              <button type="button" className="akte-gespraech-sprung" onClick={onVorlage}>
                Vorlage
              </button>
            ) : (
              <a className="akte-gespraech-sprung" href={posteingangUrl(gewaehlt!.gespraechId)}>
                Vorlage
              </a>
            )}
          </span>
        </div>
        {meldungen}
      </>
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
          data-eingabe=""
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
      {meldungen}
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
