"use client";
/**
 * Lagekarte: Lead-Panel. Desktop rechts andockend (400 px, volle Höhe unter
 * dem HUD), mobil als Bottom-Sheet (65 % der Höhe, oben bleibt Karte sichtbar). Kopf mit Status, Fakten,
 * Schnellaktionen und die Tabs Chat | Angebot | Verlauf.
 *
 * Einzige Schreibaktion: Stufe ändern (PATCH records). Alles andere liest.
 * Der Container rendert das Panel direkt in seiner `relative`-Wurzel; das
 * Panel positioniert sich selbst.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { format, formatDistanceStrict, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Phone,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { plausiblerCent, type Firma, type KartenOrt, type LeadPunkt, type StufeOption, type WertArt } from "@/lib/lagekarte/typen";
import { STATUS_STIL, WARTET_LABEL, euroAusCent } from "@/lib/lagekarte/farben";
import { StatusForm } from "@/components/lagekarte/status-form";
import { useLagekarteThema } from "@/components/lagekarte/thema";
import { DocumentPreviewModal } from "@/components/documents/document-preview-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChatVorschau from "./chat-vorschau";
import KvKarte from "./kv-karte";
import { startScrollFuerTab } from "./tab-scroll";
import Verlauf from "./verlauf";

export type PanelTab = "chat" | "angebot" | "verlauf";

export interface LeadPanelProps {
  lead: LeadPunkt;
  firmen: Firma[];
  stufen: StufeOption[];
  imFilter: boolean;
  jetzt: Date;
  startTab: PanelTab;
  onSchliessen: () => void;
  /** Nach einer Stufenänderung: Daten neu laden. */
  onGeaendert: () => void;
  mobil?: boolean;
}

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "angebot", label: "Angebot" },
  { id: "verlauf", label: "Verlauf" },
];

const WERT_ART_LABEL: Record<WertArt, string> = {
  bestaetigt: "angenommen",
  angebot: "laut Angebot",
  schaetzung: "geschätzt",
};

const AKTION =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--lk-panel-rand)] bg-[var(--lk-panel)] px-3 text-[13px] font-medium text-[var(--lk-text)] transition-colors hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--lk-panel)] max-lg:min-h-11";

const AKTION_PRIMAER =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-transparent px-3 text-[13px] font-medium transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] max-lg:min-h-11";

const ICON_KNOPF =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--lk-text-leise)] transition-colors hover:bg-[var(--lk-hover)] hover:text-[var(--lk-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] max-lg:size-11";

/** Tasten, mit denen jemand den Panel-Rumpf selbst scrollt (dann nicht mehr ans Chat-Ende springen). */
const SCROLL_TASTEN = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * Menüeintrag im Stufen-Dropdown. Überschreibt die shadcn-Standardfarben
 * (bg-accent, text-sm) mit den Lagekarte-Variablen; Höhe >= 36 px, mobil 44 px.
 */
const STUFE_EINTRAG =
  "min-h-9 cursor-pointer rounded-md pr-3 text-[13px] text-[var(--lk-text)] focus:bg-[var(--lk-hover)] focus:text-[var(--lk-text)] data-[state=checked]:font-semibold max-lg:min-h-11";

/** wartet.chatId → neuester WhatsApp → neuester Thread (chats sind neueste zuerst sortiert). */
export function standardChatId(lead: LeadPunkt): string | null {
  const wartetId = lead.wartet?.chatId;
  if (wartetId && lead.chats.some((c) => c.id === wartetId)) return wartetId;
  const whatsapp = lead.chats.find((c) => c.kanal === "whatsapp");
  if (whatsapp) return whatsapp.id;
  return lead.chats[0]?.id ?? null;
}

function sicheresDatum(iso: string): Date | null {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function umzugText(umzugAm: string | null): string {
  if (!umzugAm) return "Termin offen";
  const d = sicheresDatum(umzugAm);
  return d ? format(d, "EEEEEE, d. MMM", { locale: de }) : "Termin offen";
}

function relativ(iso: string, jetzt: Date, mitSuffix: boolean): string {
  const d = sicheresDatum(iso);
  if (!d) return "";
  return formatDistanceStrict(d, jetzt, { locale: de, addSuffix: mitSuffix });
}

function ortText(ort: KartenOrt | null): string {
  if (!ort) return "Unbekannt";
  return ort.plz ? `${ort.ortsname} (${ort.plz})` : ort.ortsname;
}

function vonHinweis(ort: KartenOrt | null): string {
  if (!ort) return "Keine Abholadresse erfasst";
  if (ort.quelle === "zieladresse") return "Abholort unbekannt, Position = Ziel";
  return ort.genauigkeit === "plz" ? "PLZ-Gebiet, keine genaue Adresse" : "Ort, keine genaue Adresse";
}

function telefonHref(telefon: string): string {
  return `tel:${telefon.replace(/[^\d+]/g, "")}`;
}

function Fakt({
  label,
  wert,
  hinweis,
  mono,
}: {
  label: string;
  wert: string;
  hinweis?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="k-label" style={{ color: "var(--lk-text-schwach)" }}>
        {label}
      </dt>
      <dd className={`mt-0.5 break-words text-[14px] leading-snug text-[var(--lk-text)] ${mono ? "k-mono tabular-nums" : ""}`}>
        {wert}
        {hinweis && <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--lk-text-schwach)]">{hinweis}</span>}
      </dd>
    </div>
  );
}

export default function LeadPanel({
  lead,
  firmen,
  stufen,
  imFilter,
  jetzt,
  startTab,
  onSchliessen,
  onGeaendert,
  mobil = false,
}: LeadPanelProps): JSX.Element {
  const thema = useLagekarteThema();
  const basisId = useId();
  const ueberschriftRef = useRef<HTMLHeadingElement>(null);

  const [tab, setTab] = useState<PanelTab>(startTab);
  const [besucht, setBesucht] = useState<Set<PanelTab>>(() => new Set([startTab]));
  const [chatId, setChatId] = useState<string | null>(() => standardChatId(lead));
  const [kvOffen, setKvOffen] = useState(false);
  const [stufeSpeichert, setStufeSpeichert] = useState(false);
  const [stufeAuswahl, setStufeAuswahl] = useState<string>(lead.stufe?.id ?? "");
  // Aktuelle Lead-ID für laufende Stufenänderungen (Lead kann währenddessen wechseln).
  const leadIdRef = useRef(lead.id);
  leadIdRef.current = lead.id;

  /* ── Scrollposition je Tab ──
     Fakten, Aktionen und alle Tabs teilen sich einen Scrollbereich (den Rumpf).
     „Chat“ zeigt die neueste Nachricht: sobald der Chat geladen ist, scrollt der Rumpf
     ans Ende (die Tabs kleben oben, darunter die neuesten Nachrichten und die Fußzeile).
     Hat jemand inzwischen selbst gescrollt, springt nichts mehr.
     „Angebot“ und „Verlauf“ beginnen oben (Fakten, Anrufen, KV, Stufe sichtbar), wenn ihr
     Inhalt dann noch sichtbar anfängt; sonst (mobil, wenig Höhe) klebt die Tab-Leiste oben und
     der Inhalt steht direkt darunter (tab-scroll.ts). Beim Zurückkehren bekommen sie ihre
     eigene Position wieder, nie die des Chats. */
  const rumpfRef = useRef<HTMLDivElement>(null);
  const aktionenRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const chatGeladenRef = useRef(false);
  const selbstGescrolltRef = useRef(false);
  const positionenRef = useRef<Partial<Record<PanelTab, number>>>({});

  const zumChatEnde = useCallback(() => {
    const rumpf = rumpfRef.current;
    if (rumpf) rumpf.scrollTop = rumpf.scrollHeight;
  }, []);

  const beiChatGeladen = useCallback(() => {
    chatGeladenRef.current = true;
    if (tabRef.current === "chat" && !selbstGescrolltRef.current) zumChatEnde();
  }, [zumChatEnde]);

  const chatWechseln = useCallback((id: string) => {
    selbstGescrolltRef.current = false;
    setChatId(id);
  }, []);

  // Neuer Lead: Rumpf nach oben, bis sein Chat geladen ist (vor dem Tab-Effekt, im selben Commit).
  useLayoutEffect(() => {
    chatGeladenRef.current = false;
    selbstGescrolltRef.current = false;
    positionenRef.current = {};
    if (rumpfRef.current) rumpfRef.current.scrollTop = 0;
  }, [lead.id]);

  // Tab gewechselt oder neuer Lead (der neue Inhalt steht schon im DOM, noch nicht gezeichnet):
  // Chat ans Ende, sobald geladen; sonst die gemerkte Position des Tabs, beim ersten Mal oben,
  // solange der Inhalt dann sichtbar beginnt, sonst mit klebender Tab-Leiste.
  useLayoutEffect(() => {
    const rumpf = rumpfRef.current;
    if (!rumpf) return;
    if (tab === "chat") {
      if (chatGeladenRef.current) zumChatEnde();
      else rumpf.scrollTop = positionenRef.current.chat ?? 0;
      return;
    }
    const gemerkt = positionenRef.current[tab];
    if (gemerkt !== undefined) {
      rumpf.scrollTop = gemerkt;
      return;
    }
    const aktionen = aktionenRef.current;
    const tabs = tabsRef.current;
    // Natürliche Oberkante der Tab-Leiste = Unterkante der Aktionen (die Leiste selbst klebt evtl.).
    rumpf.scrollTop = aktionen && tabs
      ? startScrollFuerTab(aktionen.offsetTop + aktionen.offsetHeight, tabs.offsetHeight, rumpf.clientHeight)
      : 0;
  }, [tab, lead.id, zumChatEnde]);

  // Neuer Lead oder neuer Start-Tab: Zustand zurücksetzen, Fokus auf Überschrift.
  useEffect(() => {
    setTab(startTab);
    setBesucht(new Set([startTab]));
    setChatId(standardChatId(lead));
    setKvOffen(false);
    setStufeAuswahl(lead.stufe?.id ?? "");
    ueberschriftRef.current?.focus({ preventScroll: true });
    // Nur bei Lead-Wechsel (lead.id) oder neuem Start-Tab; lead-Objekt wechselt bei jedem Polling.
  }, [lead.id, startTab]);

  // Polling liefert neue Lead-Objekte: Chat-Auswahl und Stufe nachziehen, ohne den Tab zu wechseln.
  useEffect(() => {
    setChatId((aktuell) => (aktuell && lead.chats.some((c) => c.id === aktuell) ? aktuell : standardChatId(lead)));
    if (!stufeSpeichert) setStufeAuswahl(lead.stufe?.id ?? "");
  }, [lead]);

  // Esc schließt das Panel (nicht, solange das PDF-Modal offen ist: das schließt sich selbst).
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || kvOffen) return;
      onSchliessen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSchliessen, kvOffen]);

  const stil = STATUS_STIL[lead.status];
  const statusFarbe = stil.farbe[thema];
  const firma = firmen.find((f) => f.id === lead.firmaId) ?? null;

  const stufenOptionen = useMemo(() => {
    const aktive = stufen.filter((s) => s.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge);
    if (lead.stufe && !aktive.some((s) => s.id === lead.stufe?.id)) {
      // Aktuelle, aber inaktive Stufe sichtbar lassen, damit das Feld nicht leer wirkt.
      return [{ id: lead.stufe.id, titel: lead.stufe.titel, inaktiv: true }, ...aktive.map((s) => ({ id: s.id, titel: s.titel, inaktiv: false }))];
    }
    return aktive.map((s) => ({ id: s.id, titel: s.titel, inaktiv: false }));
  }, [stufen, lead.stufe]);

  const ungelesenGesamt = lead.chats.reduce((n, c) => n + c.ungelesen, 0);
  const gewaehlteStufe = stufen.find((s) => s.id === stufeAuswahl) ?? null;
  const stufeTitel = gewaehlteStufe?.titel ?? lead.stufe?.titel ?? "Stufe wählen";
  const stufeFarbe = gewaehlteStufe?.farbe ?? lead.stufe?.farbe ?? null;

  function tabWaehlen(naechster: PanelTab) {
    // Position des bisherigen Tabs merken, bevor sein Inhalt verschwindet.
    if (naechster !== tab && rumpfRef.current) positionenRef.current[tab] = rumpfRef.current.scrollTop;
    if (naechster === "chat") selbstGescrolltRef.current = false;
    setTab(naechster);
    setBesucht((alt) => (alt.has(naechster) ? alt : new Set(alt).add(naechster)));
  }

  function tabTastatur(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    let ziel: number | null = null;
    if (e.key === "ArrowRight") ziel = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") ziel = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") ziel = 0;
    else if (e.key === "End") ziel = TABS.length - 1;
    if (ziel === null) return;
    e.preventDefault();
    tabWaehlen(TABS[ziel].id);
    document.getElementById(`${basisId}-tab-${TABS[ziel].id}`)?.focus();
  }

  /**
   * Wird nur bei ausdrücklicher Auswahl eines Menüeintrags aufgerufen (Klick,
   * Enter, Leertaste). Pfeiltasten bewegen im Radix-Menü nur den Fokus und
   * lösen keinen Schreibzugriff aus.
   */
  async function stufeAendern(statusId: string) {
    if (!statusId || statusId === lead.stufe?.id || stufeSpeichert) return;
    const leadIdBeimStart = lead.id;
    const vorherigeStufe = lead.stufe?.id ?? "";
    // Nur zurücksetzen, wenn inzwischen kein anderer Lead ausgewählt wurde.
    const zuruecksetzen = () => {
      if (leadIdRef.current === leadIdBeimStart) setStufeAuswahl(vorherigeStufe);
    };
    setStufeAuswahl(statusId);
    setStufeSpeichert(true);
    try {
      const res = await fetch(`/api/v1/objects/deals/records/${encodeURIComponent(leadIdBeimStart)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { stage: statusId } }),
      });
      if (!res.ok) {
        let meldung = `Stufe konnte nicht geändert werden (${res.status})`;
        try {
          const body = (await res.json()) as { error?: { message?: string } | string };
          if (typeof body.error === "string") meldung = body.error;
          else if (typeof body.error?.message === "string") meldung = body.error.message;
        } catch {
          /* Antwort ohne JSON */
        }
        toast.error(meldung);
        zuruecksetzen();
        return;
      }
      toast.success("Stufe geändert");
      onGeaendert();
    } catch {
      toast.error("Stufe konnte nicht geändert werden (keine Verbindung)");
      zuruecksetzen();
    } finally {
      setStufeSpeichert(false);
    }
  }

  const inboxHref = chatId ? `/inbox?conv=${encodeURIComponent(chatId)}` : null;
  const kvUrl = lead.kv.dokumentId
    ? `/api/v1/deals/${encodeURIComponent(lead.id)}/documents/${encodeURIComponent(lead.kv.dokumentId)}`
    : null;

  const wurzelKlasse = mobil
    ? // Höchstens 65 %: oben bleiben HUD, Quellenzeile und ein Streifen Karte mit dem Marker sichtbar.
      "lk-glas absolute inset-x-0 bottom-0 z-30 flex h-[65%] flex-col pb-[env(safe-area-inset-bottom)]"
    : "lk-glas absolute right-3 top-[var(--lk-oben,96px)] bottom-3 z-30 flex w-[400px] max-w-[calc(100%-24px)] flex-col";
  // .lk-glas ist unlayered und schlägt Tailwind-Utilities, deshalb die Sheet-Ecken inline.
  const wurzelStil = mobil ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined;

  return (
    <>
      <section aria-labelledby={`${basisId}-titel`} className={wurzelKlasse} style={wurzelStil} data-testid="lead-panel">
        {mobil && (
          <button
            type="button"
            onClick={onSchliessen}
            aria-label="Panel schließen"
            className="flex h-11 w-full shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--lk-akzent)]"
          >
            <span className="h-1.5 w-10 rounded-full" style={{ background: "var(--lk-text-schwach)", opacity: 0.5 }} />
          </button>
        )}

        {/* Kopf */}
        <header className={`shrink-0 px-4 pb-3 ${mobil ? "pt-1" : "pt-4"}`}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 text-[11.5px] font-medium"
                  style={{
                    color: statusFarbe,
                    borderColor: `color-mix(in oklab, ${statusFarbe} 35%, transparent)`,
                    background: `color-mix(in oklab, ${statusFarbe} 12%, transparent)`,
                  }}
                >
                  <StatusForm status={lead.status} thema={thema} groesse={14} wartet={Boolean(lead.wartet)} />
                  {stil.label}
                </span>
                {lead.nummer && (
                  <span className="k-mono text-[12px] tabular-nums text-[var(--lk-text-schwach)]">{lead.nummer}</span>
                )}
                {firma && (
                  <span
                    className="inline-flex h-6 items-center gap-1.5 rounded-full pl-1 pr-2 text-[11.5px] font-medium text-[var(--lk-text-leise)]"
                    style={{ background: "var(--lk-aktiv)" }}
                    title={firma.name}
                  >
                    <span
                      className="k-mono inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                      style={{ background: firma.farbe }}
                      aria-hidden="true"
                    >
                      {firma.kurz}
                    </span>
                    {firma.name}
                  </span>
                )}
              </div>
              <h2
                id={`${basisId}-titel`}
                ref={ueberschriftRef}
                tabIndex={-1}
                className="k-display mt-1.5 break-words text-[22px] leading-tight text-[var(--lk-text)] outline-none focus-visible:underline focus-visible:decoration-[var(--lk-akzent)] focus-visible:underline-offset-4"
              >
                {lead.name}
              </h2>
            </div>
            <button type="button" onClick={onSchliessen} aria-label="Schließen (Esc)" title="Schließen (Esc)" className={ICON_KNOPF}>
              <X className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
          </div>

          {lead.statusHinweis && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug" style={{ color: "var(--lk-warn)" }}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{lead.statusHinweis}</span>
            </p>
          )}

          {lead.wert && plausiblerCent(lead.wert) === null && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug" style={{ color: "var(--lk-warn)" }}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Wert ungewöhnlich hoch: {euroAusCent(lead.wert.cent)}, bitte prüfen</span>
            </p>
          )}

          {lead.wartet && (
            <div
              className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium"
              style={{
                color: "var(--lk-wartet)",
                background: "color-mix(in oklab, var(--lk-wartet) 12%, transparent)",
              }}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{WARTET_LABEL[lead.wartet.art]}</span>
              <span className="k-mono ml-auto text-[11px] font-normal tabular-nums">seit {relativ(lead.wartet.seit, jetzt, false)}</span>
            </div>
          )}

          {!imFilter && (
            <p className="mt-2 text-[12px] text-[var(--lk-text-schwach)]">Nicht im aktuellen Filter</p>
          )}
        </header>

        {/* Rumpf */}
        <div
          ref={rumpfRef}
          // relative: offsetTop der Kinder zählt ab der Rumpf-Oberkante (Tab-Start, siehe oben).
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onWheel={() => {
            selbstGescrolltRef.current = true;
          }}
          onTouchMove={() => {
            selbstGescrolltRef.current = true;
          }}
          onKeyDown={(e) => {
            if (!e.defaultPrevented && SCROLL_TASTEN.has(e.key)) selbstGescrolltRef.current = true;
          }}
        >
          {/* Fakten */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--lk-panel-rand)] px-4 py-3">
            <Fakt label="Von" wert={ortText(lead.ort)} hinweis={vonHinweis(lead.ort)} />
            <Fakt label="Nach" wert={ortText(lead.ziel)} hinweis={lead.ziel ? undefined : "Kein Zielort erfasst"} />
            <Fakt label="Umzug" wert={umzugText(lead.umzugAm)} />
            <Fakt
              label="Wert"
              wert={lead.wert ? euroAusCent(lead.wert.cent) : "unbekannt"}
              hinweis={lead.wert ? WERT_ART_LABEL[lead.wert.art] : undefined}
            />
            {lead.bezahltCent > 0 && <Fakt label="Bezahlt" wert={euroAusCent(lead.bezahltCent)} />}
            <Fakt label="Eingang" wert={relativ(lead.angelegtAm, jetzt, true)} />
          </dl>

          {/* Schnellaktionen */}
          <div ref={aktionenRef} className="flex flex-wrap gap-2 border-t border-[var(--lk-panel-rand)] px-4 py-3">
            {inboxHref ? (
              <Link
                href={inboxHref}
                className={AKTION_PRIMAER}
                style={{ background: "var(--lk-blase-aus)", color: "var(--lk-blase-aus-text)" }}
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                Im Posteingang antworten
              </Link>
            ) : (
              <button type="button" className={AKTION_PRIMAER} disabled title="Kein Chat vorhanden" style={{ background: "var(--lk-aktiv)", color: "var(--lk-text-schwach)", cursor: "not-allowed" }}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                Im Posteingang antworten
              </button>
            )}
            {lead.telefon && (
              <a href={telefonHref(lead.telefon)} className={AKTION} title={lead.telefon}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                Anrufen
              </a>
            )}
            {kvUrl && (
              <button type="button" className={AKTION} onClick={() => setKvOffen(true)}>
                <FileText className="h-4 w-4" aria-hidden="true" />
                KV ansehen
              </button>
            )}
            <Link href={`/objects/deals/${encodeURIComponent(lead.id)}`} className={AKTION}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Lead öffnen
            </Link>
            {/* Stufe: Radix-Menü statt nativem <select>, damit Pfeiltasten nur den
                Fokus bewegen und erst Klick/Enter/Leertaste die Stufe schreibt. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`${AKTION} pr-2.5`}
                  disabled={stufeSpeichert || stufenOptionen.length === 0}
                  title="Stufe ändern"
                >
                  <span className="sr-only">Stufe: </span>
                  {stufeSpeichert ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: stufeFarbe ?? "var(--lk-text-schwach)" }}
                    />
                  )}
                  <span className="max-w-[160px] truncate">{stufeTitel}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--lk-text-schwach)]" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={6}
                collisionPadding={8}
                // Portal liegt außerhalb der .lagekarte-Wurzel: Variablen hier neu setzen.
                className={`lagekarte ${thema === "dunkel" ? "lagekarte--dunkel" : ""} lk-glas min-w-[200px] p-1.5`}
                style={{ borderRadius: 12 }}
              >
                <DropdownMenuLabel className="k-label px-2 pb-1 pt-1.5 font-normal" style={{ color: "var(--lk-text-schwach)" }}>
                  Stufe ändern
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={stufeAuswahl} onValueChange={(wert) => void stufeAendern(wert)}>
                  {stufenOptionen.map((s) => {
                    const farbe = stufen.find((o) => o.id === s.id)?.farbe ?? lead.stufe?.farbe ?? null;
                    return (
                      <DropdownMenuRadioItem key={s.id} value={s.id} disabled={s.inaktiv} className={STUFE_EINTRAG}>
                        <span
                          aria-hidden="true"
                          className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: farbe ?? "var(--lk-text-schwach)" }}
                        />
                        <span className="truncate">{s.titel}</span>
                        {s.inaktiv && <span className="ml-1 text-[11.5px] text-[var(--lk-text-schwach)]">(inaktiv)</span>}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tabs */}
          <div
            ref={tabsRef}
            role="tablist"
            aria-label="Lead-Bereiche"
            className="sticky top-0 z-10 flex border-y border-[var(--lk-panel-rand)] px-2"
            style={{
              background: "color-mix(in oklab, var(--lk-panel) 94%, transparent)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            {TABS.map((t) => {
              const aktiv = t.id === tab;
              const badge = t.id === "chat" && ungelesenGesamt > 0 ? ungelesenGesamt : null;
              return (
                <button
                  key={t.id}
                  id={`${basisId}-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={aktiv}
                  aria-controls={`${basisId}-panel-${t.id}`}
                  tabIndex={aktiv ? 0 : -1}
                  onClick={() => tabWaehlen(t.id)}
                  onKeyDown={tabTastatur}
                  className="relative inline-flex min-h-10 items-center gap-1.5 px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--lk-akzent)] max-lg:min-h-11"
                  style={{
                    color: aktiv ? "var(--lk-text)" : "var(--lk-text-leise)",
                    fontWeight: aktiv ? 600 : 500,
                  }}
                >
                  {t.label}
                  {badge !== null && (
                    <span
                      className="k-mono inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white"
                      style={{ background: "var(--lk-wartet)" }}
                      aria-label={`${badge} ungelesen`}
                    >
                      {badge}
                    </span>
                  )}
                  {aktiv && (
                    <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ background: "var(--lk-akzent)" }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab-Inhalte: einmal besucht bleiben sie gemountet, damit nichts doppelt lädt. */}
          {TABS.map((t) =>
            besucht.has(t.id) ? (
              <div
                key={t.id}
                id={`${basisId}-panel-${t.id}`}
                role="tabpanel"
                aria-labelledby={`${basisId}-tab-${t.id}`}
                hidden={t.id !== tab}
                // Mindestens Rumpf minus Tab-Leiste (42 px, mobil 46 px): auch kurzer Inhalt (Verlauf
                // lädt noch) lässt die Tab-Leiste oben kleben, statt die Scrollposition zu kappen.
                className={t.id === "chat" ? undefined : "min-h-[calc(100%-42px)] max-lg:min-h-[calc(100%-46px)]"}
              >
                {t.id === "chat" && (
                  <ChatVorschau lead={lead} chatId={chatId} onChatWechsel={chatWechseln} jetzt={jetzt} onGeladen={beiChatGeladen} />
                )}
                {t.id === "angebot" && <KvKarte lead={lead} onKvAnsehen={() => setKvOffen(true)} />}
                {t.id === "verlauf" && <Verlauf leadId={lead.id} />}
              </div>
            ) : null
          )}
        </div>
      </section>

      {kvOffen &&
        kvUrl &&
        createPortal(
          <DocumentPreviewModal
            url={kvUrl}
            downloadUrl={`${kvUrl}?download=1`}
            mimeType="application/pdf"
            fileName={`KV ${lead.nummer ?? lead.name}.pdf`}
            onClose={() => setKvOffen(false)}
          />,
          document.body
        )}
    </>
  );
}
