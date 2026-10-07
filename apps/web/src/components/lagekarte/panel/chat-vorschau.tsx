"use client";
/**
 * Lagekarte, Panel-Tab „Chat“: lesende Vorschau des gewählten Threads
 * (GET /api/v1/lagekarte/chat/{id}, ohne Gelesen-Markierung). Kanal-Chips
 * zum Umschalten, Blasen, Hinweise, Fußzeile „Im Posteingang antworten“.
 * Kein Antwortfeld: Antworten laufen über den Posteingang.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { format, isSameDay, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import type { ChatKanal, ChatKurz, ChatVorschauAntwort, LeadPunkt } from "@/lib/lagekarte/typen";

const KANAL_LABEL: Record<ChatKanal, string> = {
  whatsapp: "WhatsApp",
  email: "E-Mail",
  sms: "SMS",
};

type Zustand =
  | { status: "laedt" }
  | { status: "fehler"; meldung: string }
  | { status: "ok"; daten: ChatVorschauAntwort };

const KNOPF =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--lk-panel-rand)] bg-[var(--lk-panel)] px-3 text-[13px] font-medium text-[var(--lk-text)] transition-colors hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]";

const KNOPF_PRIMAER =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]";

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
}

export default function ChatVorschau({ lead, chatId, onChatWechsel, jetzt }: ChatVorschauProps) {
  const [zustand, setZustand] = useState<Zustand>({ status: "laedt" });
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    if (!chatId) return;
    const ac = new AbortController();
    setZustand({ status: "laedt" });
    (async () => {
      try {
        const res = await fetch(`/api/v1/lagekarte/chat/${encodeURIComponent(chatId)}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          setZustand({
            status: "fehler",
            meldung: res.status === 404 ? "Chat nicht gefunden" : `Chat konnte nicht geladen werden (${res.status})`,
          });
          return;
        }
        const body = (await res.json()) as { data?: ChatVorschauAntwort };
        if (!body.data || !Array.isArray(body.data.nachrichten)) {
          setZustand({ status: "fehler", meldung: "Chat ist leer" });
          return;
        }
        setZustand({ status: "ok", daten: body.data });
      } catch {
        if (ac.signal.aborted) return;
        setZustand({ status: "fehler", meldung: "Chat konnte nicht geladen werden" });
      }
    })();
    return () => ac.abort();
  }, [chatId, versuch]);

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
                  className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]"
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

      {/* Nachrichten */}
      <div className="px-4 py-3">
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
            {zustand.daten.mehr && (
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
              <ol className="space-y-2" aria-label="Nachrichten">
                {zustand.daten.nachrichten.map((n) => {
                  const eingehend = n.richtung === "inbound";
                  return (
                    <li key={n.id} className={`flex flex-col ${eingehend ? "items-start" : "items-end"}`}>
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
                        {n.text}
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

      {/* Fußzeile */}
      <div className="sticky bottom-0 border-t border-[var(--lk-panel-rand)] px-4 py-3" style={{ background: "var(--lk-panel)" }}>
        <Link
          href={inboxHref}
          className={`${KNOPF_PRIMAER} w-full`}
          style={{ background: "var(--lk-blase-aus)", color: "var(--lk-blase-aus-text)" }}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Im Posteingang antworten
        </Link>
      </div>
    </div>
  );
}
