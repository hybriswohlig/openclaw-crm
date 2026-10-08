"use client";
/**
 * Lagekarte, Panel-Tab „Chat“: lesende Vorschau des gewählten Threads
 * (GET /api/v1/lagekarte/chat/{id}, ohne Gelesen-Markierung). Kanal-Chips
 * zum Umschalten, Blasen, Hinweise, Fußzeile „Im Posteingang antworten“.
 * Kein Antwortfeld: Antworten laufen über den Posteingang.
 *
 * Die Nachrichten stehen chronologisch, die neueste unten. Nach dem Laden
 * meldet `onGeladen` das dem Panel, das dann ans Ende scrollt (sonst stünde
 * die älteste der 20 Nachrichten im Blick statt der, auf die der Kunde wartet).
 *
 * Aktualisierung: Ändern sich beim Polling `letzteNachrichtAm` oder `ungelesen`
 * des gewählten Threads, lädt die Vorschau leise neu (ohne Ladeskelett). Das
 * Panel lässt die Scrollposition stehen, außer der Nutzer war ganz unten
 * (`istGanzUnten` vor dem Austausch gemessen): dann ans neue Ende.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { format, isSameDay, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { Image as BildIcon, MessageSquare, Paperclip, RefreshCw, Sparkles } from "lucide-react";
import { beispielChatVorschau } from "@/lib/lagekarte/beispiel-daten";
import type { ChatKanal, ChatKurz, ChatVorschauAntwort, LeadPunkt } from "@/lib/lagekarte/typen";
import { useVorschau, VORSCHAU_TITEL } from "../vorschau";

const KANAL_LABEL: Record<ChatKanal, string> = {
  whatsapp: "WhatsApp",
  email: "E-Mail",
  sms: "SMS",
};

type Zustand =
  | { status: "laedt" }
  | { status: "fehler"; meldung: string }
  | { status: "ok"; daten: ChatVorschauAntwort; chatId: string };

/** Was nach dem Laden ans Panel geht: leise = Hintergrund-Aktualisierung desselben Threads. */
export type ChatGeladen = { leise: false } | { leise: true; warUnten: boolean };

/** Ändert sich dieser Schlüssel beim Polling, ist im Thread etwas passiert. */
function threadStand(chat: ChatKurz | undefined): string {
  return chat ? `${chat.letzteNachrichtAm ?? ""}|${chat.ungelesen}` : "";
}

async function ladeChat(chatId: string, signal: AbortSignal): Promise<Zustand> {
  const res = await fetch(`/api/v1/lagekarte/chat/${encodeURIComponent(chatId)}`, { signal });
  if (!res.ok) {
    return {
      status: "fehler",
      meldung: res.status === 404 ? "Chat nicht gefunden" : `Chat konnte nicht geladen werden (${res.status})`,
    };
  }
  const body = (await res.json()) as { data?: ChatVorschauAntwort };
  if (!body.data || !Array.isArray(body.data.nachrichten)) return { status: "fehler", meldung: "Chat ist leer" };
  return { status: "ok", daten: body.data, chatId };
}

const KNOPF =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--lk-panel-rand)] bg-[var(--lk-panel)] px-3 text-[13px] font-medium text-[var(--lk-text)] transition-colors hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] max-lg:min-h-11";

const KNOPF_PRIMAER =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] max-lg:min-h-11";

function zeitText(iso: string, jetzt: Date): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, isSameDay(d, jetzt) ? "HH:mm" : "EEEEEE, d. MMM, HH:mm", { locale: de });
}

function chatLabel(chat: ChatKurz): string {
  return `${KANAL_LABEL[chat.kanal]} · ${chat.kontoName}`;
}

interface ChatVorschauProps {
  lead: LeadPunkt;
  /** Aktiver Thread; null, wenn der Lead keine Chats hat. */
  chatId: string | null;
  onChatWechsel: (chatId: string) => void;
  jetzt: Date;
  /** Nachrichten eines Threads stehen im DOM (vor dem Zeichnen): Panel scrollt zur neuesten. */
  onGeladen?: (art: ChatGeladen) => void;
  /** Steht der Scrollbereich gerade ganz unten? (vor einer leisen Aktualisierung gefragt) */
  istGanzUnten?: () => boolean;
  /** Mobil: ohne klebende Fußzeile (der Posteingang-Knopf steht dort im Panelkopf). */
  ohneFuss?: boolean;
}

export default function ChatVorschau({ lead, chatId, onChatWechsel, jetzt, onGeladen, istGanzUnten, ohneFuss = false }: ChatVorschauProps) {
  const vorschau = useVorschau();
  const [zustandRoh, setZustand] = useState<Zustand>({ status: "laedt" });
  // Nach einem Chip-Wechsel zeigt der alte Thread nie unter dem neuen Chip (bis der Effekt lädt).
  const zustand: Zustand = zustandRoh.status === "ok" && zustandRoh.chatId !== chatId ? { status: "laedt" } : zustandRoh;
  const [versuch, setVersuch] = useState(0);
  const onGeladenRef = useRef(onGeladen);
  onGeladenRef.current = onGeladen;
  const istGanzUntenRef = useRef(istGanzUnten);
  istGanzUntenRef.current = istGanzUnten;
  /** Gesetzt, wenn der nächste Datenstand eine leise Aktualisierung ist. */
  const leiseRef = useRef<{ warUnten: boolean } | null>(null);
  const zustandRef = useRef(zustand);
  zustandRef.current = zustand;

  const stand = threadStand(lead.chats.find((c) => c.id === chatId));
  /** Thread-Stand, zu dem die angezeigten Nachrichten gehören (bzw. gerade geladen werden). */
  const geladenerStand = useRef(stand);

  // Layout-Effekt: das Panel scrollt, bevor der Browser die Liste oben zeichnet (kein Springen).
  useLayoutEffect(() => {
    if (zustandRoh.status !== "ok") return;
    const leise = leiseRef.current;
    leiseRef.current = null;
    onGeladenRef.current?.(leise ? { leise: true, warUnten: leise.warUnten } : { leise: false });
  }, [zustandRoh]);

  useEffect(() => {
    if (!chatId) return;
    geladenerStand.current = stand;
    leiseRef.current = null;
    // Vorschau: erfundene Nachrichten, kein Abruf.
    if (vorschau) {
      setZustand({ status: "ok", daten: beispielChatVorschau(chatId), chatId });
      return;
    }
    const ac = new AbortController();
    setZustand({ status: "laedt" });
    ladeChat(chatId, ac.signal)
      .then((z) => {
        if (!ac.signal.aborted) setZustand(z);
      })
      .catch(() => {
        if (!ac.signal.aborted) setZustand({ status: "fehler", meldung: "Chat konnte nicht geladen werden" });
      });
    return () => ac.abort();
    // stand nur als Startwert, eine Änderung lädt leise (Effekt unten)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, versuch, vorschau]);

  // Polling hat im gewählten Thread etwas Neues gemeldet: leise nachladen, ohne Skelett.
  useEffect(() => {
    if (!chatId || vorschau || stand === geladenerStand.current) return;
    if (zustandRef.current.status !== "ok") return; // erstes Laden läuft oder Fehler: dort bleibt es
    geladenerStand.current = stand;
    const ac = new AbortController();
    ladeChat(chatId, ac.signal)
      .then((z) => {
        if (ac.signal.aborted || z.status !== "ok") return; // Fehler beim Nachladen: alter Stand bleibt
        // Vor dem Austausch messen: stand der Nutzer ganz unten, folgt die Ansicht dem neuen Ende.
        leiseRef.current = { warUnten: istGanzUntenRef.current?.() ?? false };
        setZustand(z);
      })
      .catch(() => {
        /* Netzfehler beim Nachladen: alter Stand bleibt sichtbar */
      });
    return () => ac.abort();
  }, [chatId, vorschau, stand]);

  if (lead.chats.length === 0 || !chatId) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <MessageSquare className="h-6 w-6 text-[var(--lk-text-schwach)]" aria-hidden="true" />
        <p className="text-[13px] text-[var(--lk-text-leise)]">Noch kein Chat zu diesem Lead.</p>
      </div>
    );
  }

  const inboxHref = `/inbox?conv=${encodeURIComponent(chatId)}`;
  const aktiverChat = lead.chats.find((c) => c.id === chatId) ?? lead.chats[0];

  return (
    <div className="flex flex-col">
      {/* Kanal-Umschalter */}
      <div className="px-4 pt-3">
        {lead.chats.length > 1 ? (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Chat wählen">
            {lead.chats.map((c) => {
              const aktiv = c.id === chatId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={aktiv}
                  onClick={() => onChatWechsel(c.id)}
                  className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] max-lg:min-h-11"
                  style={
                    aktiv
                      ? {
                          background: "var(--lk-blase-aus)",
                          color: "var(--lk-blase-aus-text)",
                          borderColor: "transparent",
                        }
                      : {
                          background: "var(--lk-panel)",
                          color: c.status === "open" ? "var(--lk-text)" : "var(--lk-text-schwach)",
                          borderColor: "var(--lk-panel-rand)",
                        }
                  }
                >
                  {chatLabel(c)}
                  {c.ungelesen > 0 && (
                    <span
                      className="k-mono rounded-full px-1.5 text-[10px] leading-4"
                      style={{
                        background: aktiv ? "var(--lk-blase-aus-text)" : "var(--lk-wartet)",
                        color: aktiv ? "var(--lk-blase-aus)" : "#fff",
                      }}
                      aria-label={`${c.ungelesen} ungelesen`}
                    >
                      {c.ungelesen}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="k-label" style={{ color: "var(--lk-text-schwach)" }}>
            {chatLabel(aktiverChat)}
          </div>
        )}
      </div>

      {/* Hinweise */}
      {lead.kiEntwurfWartet && (
        <div
          className="mx-4 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{
            background: "color-mix(in oklab, var(--lk-akzent) 12%, transparent)",
            color: "var(--lk-text)",
          }}
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--lk-akzent)" }} aria-hidden="true" />
          <span>KI-Entwurf wartet auf Freigabe im Posteingang</span>
        </div>
      )}

      {/* Nachrichten (mobil ohne Fußzeile etwas enger, damit drei Blasen passen) */}
      <div className={`px-4 ${ohneFuss ? "py-2" : "py-3"}`}>
        {zustand.status === "laedt" && (
          <div className="space-y-3" aria-busy="true" aria-label="Chat wird geladen">
            {[72, 48, 64, 40].map((w, i) => (
              <div key={i} className={`flex ${i % 2 === 1 ? "justify-end" : "justify-start"}`}>
                <div
                  className="h-10 animate-pulse rounded-2xl bg-[var(--lk-aktiv)]"
                  style={{ width: `${w}%` }}
                />
              </div>
            ))}
          </div>
        )}

        {zustand.status === "fehler" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] text-[var(--lk-warn)]">{zustand.meldung}</p>
            <button type="button" className={KNOPF} onClick={() => setVersuch((v) => v + 1)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Erneut versuchen
            </button>
          </div>
        )}

        {zustand.status === "ok" && (
          <>
            {zustand.daten.mehr && !vorschau && (
              <div className="mb-3 text-center">
                <Link
                  href={inboxHref}
                  className="text-[12px] text-[var(--lk-text-schwach)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]"
                >
                  Ältere Nachrichten im Posteingang
                </Link>
              </div>
            )}
            {zustand.daten.nachrichten.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--lk-text-schwach)]">Noch keine Nachrichten.</p>
            ) : (
              <ol className={ohneFuss ? "space-y-1.5" : "space-y-2"} aria-label="Nachrichten">
                {zustand.daten.nachrichten.map((n) => {
                  const eingehend = n.richtung === "inbound";
                  return (
                    <li key={n.id} data-blase className={`flex flex-col ${eingehend ? "items-start" : "items-end"}`}>
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                          eingehend ? "rounded-bl-md" : "rounded-br-md"
                        }`}
                        style={
                          eingehend
                            ? { background: "var(--lk-blase-ein)", color: "var(--lk-text)" }
                            : { background: "var(--lk-blase-aus)", color: "var(--lk-blase-aus-text)" }
                        }
                      >
                        {n.anhaenge > 0 ? (
                          // Anhänge: Symbol vor dem Text (ohne Text steht dort „Foto“ bzw. „Anhang“).
                          <span className="inline-flex items-start gap-1.5">
                            {n.anhangArt === "foto" ? (
                              <BildIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-label="Foto" role="img" />
                            ) : (
                              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-label="Anhang" role="img" />
                            )}
                            <span className="min-w-0">{n.text}</span>
                          </span>
                        ) : (
                          n.text
                        )}
                      </div>
                      <time
                        dateTime={n.zeit}
                        className="k-mono mt-0.5 px-1 text-[10.5px] text-[var(--lk-text-schwach)]"
                      >
                        {eingehend ? "" : "Du · "}
                        {zeitText(n.zeit, jetzt)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </div>

      {/* Lücke am Ende: das Panel setzt ihre Höhe so, dass oben keine Blase unter der Tab-Leiste angeschnitten ist. */}
      <div data-chat-luecke aria-hidden="true" style={{ height: 0 }} />

      {/* Fußzeile */}
      <div
        data-chat-fuss
        className={`sticky bottom-0 border-t border-[var(--lk-panel-rand)] px-4 py-3 ${ohneFuss ? "hidden" : ""}`}
        style={{ background: "var(--lk-panel)" }}
      >
        {vorschau ? (
          <button
            type="button"
            disabled
            title={VORSCHAU_TITEL}
            className={`${KNOPF_PRIMAER} w-full cursor-not-allowed opacity-60`}
            style={{ background: "var(--lk-blase-aus)", color: "var(--lk-blase-aus-text)" }}
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Im Posteingang antworten
          </button>
        ) : (
          <Link
            href={inboxHref}
            className={`${KNOPF_PRIMAER} w-full`}
            style={{ background: "var(--lk-blase-aus)", color: "var(--lk-blase-aus-text)" }}
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Im Posteingang antworten
          </Link>
        )}
      </div>
    </div>
  );
}
