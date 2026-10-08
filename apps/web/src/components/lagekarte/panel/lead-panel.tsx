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
import { plausiblerCent, type Firma, type KartenOrt, type LeadPunkt, type StufeOption } from "@/lib/lagekarte/typen";
import { STATUS_STIL, WARTET_LABEL, WERT_ART_LABEL, euroAusCent } from "@/lib/lagekarte/farben";
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
import ChatVorschau, { type ChatGeladen } from "./chat-vorschau";
import KvKarte from "./kv-karte";
import { useVorschau, VORSCHAU_TITEL } from "../vorschau";
import { telefonFuerLink } from "@/lib/lagekarte/telefon";
import { warteText } from "@/lib/lagekarte/warte-text";
import { chatLuecke, startScrollFuerTab } from "./tab-scroll";
import {
  angezeigteStufe,
  erstelleStufenProtokoll,
  leseStufe,
  pruefeRueckgaengig,
  stufeNachlesen,
  stufenName,
  type Schreibung,
} from "./stufen-wechsel";
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
  /** Nach einer Stufenänderung: Daten neu laden. Das Panel wartet darauf (höchstens NEU_LADEN_MAX_MS). */
  onGeaendert: () => Promise<void> | void;
  mobil?: boolean;
}

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "angebot", label: "Angebot" },
  { id: "verlauf", label: "Verlauf" },
];

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

/** So lange wartet eine Stufenänderung höchstens auf die neu geladene Karte, dann ist das Menü wieder frei. */
const NEU_LADEN_MAX_MS = 4000;
const RUECKGAENGIG_MS = 8000;

/** Für alle Panels dieses Tabs: Das Panel kann schließen, während ein Toast noch „Rückgängig“ anbietet. */
const stufenProtokoll = erstelleStufenProtokoll();
/** Nur der Toast der letzten Änderung bietet „Rückgängig“ an. */
let rueckgaengigToast: string | null = null;

function rueckgaengigToastSchliessen() {
  if (rueckgaengigToast !== null) toast.dismiss(rueckgaengigToast);
  rueckgaengigToast = null;
}

/** Toast-Text für Ausnahmen; fetch meldet fehlende Verbindung als TypeError. */
function ausnahmeText(err: unknown, wobei: string): string {
  return err instanceof Error && !(err instanceof TypeError) ? err.message : `${wobei} (keine Verbindung)`;
}

/** Eine erfolgreiche Änderung aus dem Panel, die der Toast rückgängig machen kann. */
interface Aenderung {
  schreibung: Schreibung;
  leadId: string;
  leadName: string;
  /** Gespeicherte Stufe direkt vor der Änderung (null = keine). */
  von: string | null;
  nach: string;
}

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

function Fakt({
  label,
  wert,
  hinweis,
  warnung,
  mono,
}: {
  label: string;
  wert: string;
  hinweis?: string;
  /** Gedämpfter Wert mit Warnzeile (z. B. unplausibel hoher Betrag). */
  warnung?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="k-label" style={{ color: "var(--lk-text-schwach)" }}>
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-[14px] leading-snug ${warnung ? "text-[var(--lk-text-schwach)]" : "text-[var(--lk-text)]"} ${mono ? "k-mono tabular-nums" : ""}`}
      >
        {wert}
        {hinweis && <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--lk-text-schwach)]">{hinweis}</span>}
        {warnung && (
          <span className="mt-0.5 flex items-start gap-1 text-[11.5px] leading-snug" style={{ color: "var(--lk-warn)" }}>
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            {warnung}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Schreibt die Stufe über dieselbe Route und Form wie die Deal-Seite. Liefert null bei Erfolg,
 * sonst die Fehlermeldung für den Toast. Netzwerkfehler werfen (Aufrufer fängt sie).
 */
async function speichereStufe(leadId: string, statusId: string | null): Promise<string | null> {
  const res = await fetch(`/api/v1/objects/deals/records/${encodeURIComponent(leadId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: { stage: statusId } }),
  });
  if (res.ok) return null;
  let meldung = `Stufe konnte nicht geändert werden (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    if (typeof body.error === "string") meldung = body.error;
    else if (typeof body.error?.message === "string") meldung = body.error.message;
  } catch {
    /* Antwort ohne JSON */
  }
  return meldung;
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
  // Vorschau: alles Schreibende oder nach außen Führende gesperrt (erfundene IDs und Nummern).
  const vorschau = useVorschau();
  const basisId = useId();
  const ueberschriftRef = useRef<HTMLHeadingElement>(null);

  const [tab, setTab] = useState<PanelTab>(startTab);
  const [besucht, setBesucht] = useState<Set<PanelTab>>(() => new Set([startTab]));
  const [chatId, setChatId] = useState<string | null>(() => standardChatId(lead));
  const [kvOffen, setKvOffen] = useState(false);
  // Leads mit laufender Stufenänderung aus diesem Panel; das Menü sperrt nur für den gezeigten Lead.
  const [speichert, setSpeichert] = useState<ReadonlySet<string>>(() => new Set());
  const stufeSpeichert = speichert.has(lead.id);
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

  /** Ans Chat-Ende; die oberste sichtbare Blase rastet unter der klebenden Tab-Leiste ein (chatLuecke). */
  const zumChatEnde = useCallback(() => {
    const rumpf = rumpfRef.current;
    if (!rumpf) return;
    const chat = rumpf.querySelector<HTMLElement>(`[id="${basisId}-panel-chat"]`);
    const luecke = chat?.querySelector<HTMLElement>("[data-chat-luecke]") ?? null;
    if (luecke) luecke.style.height = "0px";
    rumpf.scrollTop = rumpf.scrollHeight;
    const tabs = tabsRef.current;
    if (!chat || !luecke || !tabs) return;
    const blasen = [...chat.querySelectorAll<HTMLElement>("[data-blase]")].map((b) => {
      const r = b.getBoundingClientRect();
      return { oben: r.top, unten: r.bottom };
    });
    const hoehe = chatLuecke(blasen, tabs.getBoundingClientRect().bottom);
    if (hoehe > 0) {
      luecke.style.height = `${hoehe}px`;
      rumpf.scrollTop = rumpf.scrollHeight;
    }
  }, [basisId]);

  const beiChatGeladen = useCallback(
    (art: ChatGeladen) => {
      chatGeladenRef.current = true;
      if (tabRef.current !== "chat") return;
      // Leise Aktualisierung (Polling): Position bleibt, außer der Nutzer stand ganz unten.
      if (art.leise) {
        if (art.warUnten) zumChatEnde();
        return;
      }
      if (!selbstGescrolltRef.current) zumChatEnde();
    },
    [zumChatEnde],
  );

  /** Ganz unten = höchstens ein paar Pixel bis zum Ende (Rundung, Zoom). Nur im Chat-Tab sinnvoll. */
  const istGanzUnten = useCallback(() => {
    const rumpf = rumpfRef.current;
    if (!rumpf || tabRef.current !== "chat") return false;
    return rumpf.scrollHeight - rumpf.scrollTop - rumpf.clientHeight <= 8;
  }, []);

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
  const gewaehlteStufe = angezeigteStufe(stufeAuswahl, stufen, lead.stufe);
  const stufeTitel = gewaehlteStufe?.titel ?? (stufeAuswahl === "" ? "Stufe wählen" : "Unbekannte Stufe");
  const stufeFarbe = gewaehlteStufe?.farbe ?? null;

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

  function sperre(leadId: string, an: boolean) {
    setSpeichert((alt) => {
      if (alt.has(leadId) === an) return alt;
      const neu = new Set(alt);
      if (an) neu.add(leadId);
      else neu.delete(leadId);
      return neu;
    });
  }

  /** Wartet auf die neu geladene Karte, höchstens NEU_LADEN_MAX_MS (Ladefehler zeigt das HUD). */
  async function neuLadenAbwarten() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(onGeaendert()),
        new Promise<void>((fertig) => {
          timer = setTimeout(fertig, NEU_LADEN_MAX_MS);
        }),
      ]);
    } catch {
      /* Ladefehler meldet das HUD */
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Wird nur bei ausdrücklicher Auswahl eines Menüeintrags aufgerufen (Klick,
   * Enter, Leertaste). Pfeiltasten bewegen im Radix-Menü nur den Fokus und
   * lösen keinen Schreibzugriff aus.
   *
   * Ablauf (stufen-wechsel.ts): gespeicherte Stufe lesen (das „vorher“ für Rückgängig),
   * schreiben, Karte neu laden; erst dann ist das Menü wieder frei und der Toast bietet
   * „Rückgängig“ an. Eine neue Änderung schließt den Toast der vorigen.
   */
  async function stufeAendern(statusId: string) {
    if (vorschau || !statusId || statusId === stufeAuswahl || stufeSpeichert) return;
    const leadId = lead.id;
    const leadName = lead.name;
    if (stufenProtokoll.laeuft(leadId)) {
      toast.info("Stufe wird gerade noch gespeichert", { description: leadName });
      return;
    }
    rueckgaengigToastSchliessen();
    const schreibung = stufenProtokoll.beginne(leadId);
    // Nur anzeigen, solange dieser Lead offen ist und keine neuere Änderung läuft.
    const anzeigen = (id: string | null) => {
      if (leadIdRef.current === leadId && stufenProtokoll.istJuengste(schreibung)) setStufeAuswahl(id ?? "");
    };
    const angezeigtVorher = stufeAuswahl;
    setStufeAuswahl(statusId);
    sperre(leadId, true);
    let von: string | null | undefined;
    try {
      von = await leseStufe(leadId);
      if (von === statusId) {
        toast.info(`Stufe ist bereits „${stufenName(statusId, stufen)}“`, { description: leadName });
        await neuLadenAbwarten();
        anzeigen(statusId);
        return;
      }
      const fehler = await speichereStufe(leadId, statusId);
      if (fehler) {
        toast.error(fehler, { description: leadName });
        // Die Route kann nach dem Schreiben noch scheitern (Aktivität, Antwort): gespeicherte Stufe nachlesen.
        const jetzt = await stufeNachlesen(leadId);
        anzeigen(jetzt === undefined ? von : jetzt);
        await neuLadenAbwarten();
        return;
      }
      await neuLadenAbwarten();
      anzeigen(statusId);
      if (!stufenProtokoll.istJuengste(schreibung)) return;
      // M-8: Ein Klick schreibt sofort (auch „Verloren“, „Bezahlt“); der Toast bietet den Rückweg an.
      const aenderung: Aenderung = { schreibung, leadId, leadName, von, nach: statusId };
      const toastId = `lagekarte-stufe-${schreibung.nr}`;
      rueckgaengigToast = toastId;
      toast.success("Stufe geändert", {
        id: toastId,
        description: `${leadName}: „${stufenName(von, stufen)}“ → „${stufenName(statusId, stufen)}“`,
        duration: RUECKGAENGIG_MS,
        action: { label: "Rückgängig", onClick: () => void stufeZurueck(aenderung) },
      });
    } catch (err) {
      toast.error(ausnahmeText(err, "Stufe konnte nicht geändert werden"), { description: leadName });
      if (von === undefined) {
        // Schon das Lesen scheiterte: nichts geschrieben.
        anzeigen(angezeigtVorher);
      } else {
        // Schreiben ohne Antwort: ob es ankam, ist unklar, also nachlesen.
        const jetzt = await stufeNachlesen(leadId);
        anzeigen(jetzt === undefined ? von : jetzt);
        await neuLadenAbwarten();
      }
    } finally {
      stufenProtokoll.beende(schreibung);
      sperre(leadId, false);
    }
  }

  /**
   * Rückgängig aus dem Erfolgs-Toast. Schreibt nur, wenn dies noch die jüngste Änderung des
   * Leads ist und die gespeicherte Stufe noch die damals geschriebene; sonst bleibt alles stehen.
   */
  async function stufeZurueck(a: Aenderung) {
    if (rueckgaengigToast === `lagekarte-stufe-${a.schreibung.nr}`) rueckgaengigToast = null;
    if (!stufenProtokoll.istJuengste(a.schreibung)) {
      toast.error("Rückgängig nicht mehr möglich: Die Stufe wurde danach erneut geändert.", { description: a.leadName });
      return;
    }
    // Ab hier ist die ursprüngliche Änderung veraltet: ein zweiter Klick schreibt nichts.
    const rueck = stufenProtokoll.beginne(a.leadId);
    const anzeigen = (id: string | null) => {
      if (leadIdRef.current === a.leadId && stufenProtokoll.istJuengste(rueck)) setStufeAuswahl(id ?? "");
    };
    // Gescheitert: gespeicherte Stufe neu lesen und zeigen, sonst sagen, dass die Anzeige veraltet sein kann.
    const scheitern = async (fehler: string) => {
      const gespeichert = await stufeNachlesen(a.leadId);
      if (gespeichert !== undefined) anzeigen(gespeichert);
      toast.error(`Rückgängig fehlgeschlagen: ${fehler}`, {
        description:
          gespeichert === undefined
            ? `${a.leadName} · Angezeigte Stufe kann veraltet sein`
            : `${a.leadName} · Gespeichert ist „${stufenName(gespeichert, stufen)}“`,
      });
      await neuLadenAbwarten();
    };
    sperre(a.leadId, true);
    try {
      const gespeichert = await leseStufe(a.leadId);
      const pruefung = pruefeRueckgaengig(stufenProtokoll.istJuengste(rueck), gespeichert, a.nach);
      if (!pruefung.ok) {
        toast.error(
          pruefung.grund === "fremd"
            ? `Rückgängig abgebrochen: Die Stufe ist inzwischen „${stufenName(pruefung.gespeichert, stufen)}“.`
            : "Rückgängig nicht mehr möglich: Die Stufe wurde danach erneut geändert.",
          { description: a.leadName },
        );
        anzeigen(gespeichert);
        await neuLadenAbwarten();
        return;
      }
      anzeigen(a.von);
      const fehler = await speichereStufe(a.leadId, a.von);
      if (fehler) {
        await scheitern(fehler);
        return;
      }
      await neuLadenAbwarten();
      anzeigen(a.von);
      toast.success(`Stufe zurück auf „${stufenName(a.von, stufen)}“`, { description: a.leadName });
    } catch (err) {
      await scheitern(ausnahmeText(err, "Stufe konnte nicht gespeichert werden"));
    } finally {
      stufenProtokoll.beende(rueck);
      sperre(a.leadId, false);
    }
  }

  const inboxHref = chatId ? `/inbox?conv=${encodeURIComponent(chatId)}` : null;
  const telefonNummer = lead.telefon ? telefonFuerLink(lead.telefon) : null;
  const kvUrl = lead.kv.dokumentId
    ? `/api/v1/deals/${encodeURIComponent(lead.id)}/documents/${encodeURIComponent(lead.kv.dokumentId)}`
    : null;

  /* Kopf-Bausteine: Desktop im Kopf, mobil oben im Rumpf. */
  const statusChips = (
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
      {lead.nummer && <span className="k-mono text-[12px] tabular-nums text-[var(--lk-text-schwach)]">{lead.nummer}</span>}
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
  );

  const hinweise = (
    <>
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
          <span className="k-mono ml-auto text-[11px] font-normal tabular-nums">{warteText(lead.wartet.seit, jetzt)}</span>
        </div>
      )}

      {!imFilter && <p className="mt-2 text-[12px] text-[var(--lk-text-schwach)]">Nicht im aktuellen Filter</p>}
    </>
  );

  const wurzelKlasse = mobil
    ? // Höchstens 65 %: oben bleiben HUD, Quellenzeile und ein Streifen Karte mit dem Marker sichtbar.
      "lk-glas absolute inset-x-0 bottom-0 z-30 flex h-[65%] flex-col pb-[env(safe-area-inset-bottom)]"
    : "lk-glas absolute right-3 top-[var(--lk-oben,96px)] bottom-3 z-30 flex w-[400px] max-w-[calc(100%-24px)] flex-col";
  // .lk-glas ist unlayered und schlägt Tailwind-Utilities, deshalb die Sheet-Ecken inline.
  const wurzelStil = mobil ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined;

  return (
    <>
      <section aria-labelledby={`${basisId}-titel`} className={wurzelKlasse} style={wurzelStil} data-testid="lead-panel">
        {/* Mobil: Griff liegt über dem Kopf (kein eigener 44-px-Streifen); Schließen (44 px) steht im Kopf. */}
        {mobil && (
          <button
            type="button"
            onClick={onSchliessen}
            aria-label="Panel schließen"
            className="absolute top-0 left-1/2 z-20 flex h-6 w-24 -translate-x-1/2 items-start justify-center pt-1.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--lk-akzent)]"
          >
            <span className="h-1 w-10 rounded-full" style={{ background: "var(--lk-text-schwach)", opacity: 0.5 }} />
          </button>
        )}

        {/* Kopf. Mobil nur eine Zeile (Status, Name, Wartezeit, Posteingang, Schließen); Status-Chips
            und Hinweise stehen dort oben im Rumpf und scrollen mit, damit im Chat mindestens drei
            Blasen Platz haben (Kontrolle). */}
        {mobil ? (
          <header className="shrink-0 pt-2.5 pr-2 pb-0.5 pl-4">
            <div className="flex min-h-11 items-center gap-2">
              <StatusForm status={lead.status} thema={thema} groesse={16} wartet={Boolean(lead.wartet)} />
              <h2
                id={`${basisId}-titel`}
                ref={ueberschriftRef}
                tabIndex={-1}
                className="k-display min-w-0 flex-1 truncate text-[19px] leading-tight text-[var(--lk-text)] outline-none focus-visible:underline focus-visible:decoration-[var(--lk-akzent)] focus-visible:underline-offset-4"
              >
                {lead.name}
              </h2>
              {lead.wartet && (
                <span className="k-mono shrink-0 text-[11px] tabular-nums" style={{ color: "var(--lk-wartet)" }}>
                  {warteText(lead.wartet.seit, jetzt)}
                </span>
              )}
              {/* Ohne Chat-Fußzeile: „Im Posteingang antworten“ als Symbol im Kopf. */}
              {inboxHref && !vorschau ? (
                <Link href={inboxHref} aria-label="Im Posteingang antworten" title="Im Posteingang antworten" className={ICON_KNOPF}>
                  <MessageSquare className="h-4.5 w-4.5" aria-hidden="true" />
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-label="Im Posteingang antworten"
                  title={vorschau ? VORSCHAU_TITEL : "Kein Chat vorhanden"}
                  className={`${ICON_KNOPF} cursor-not-allowed opacity-50 hover:bg-transparent`}
                >
                  <MessageSquare className="h-4.5 w-4.5" aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={onSchliessen} aria-label="Schließen (Esc)" title="Schließen (Esc)" className={ICON_KNOPF}>
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>
          </header>
        ) : (
          <header className="shrink-0 px-4 pt-4 pb-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {statusChips}
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
            {hinweise}
          </header>
        )}

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
          {mobil && (
            <div className="border-t border-[var(--lk-panel-rand)] px-4 pt-2.5 pb-3">
              {statusChips}
              {hinweise}
            </div>
          )}

          {/* Fakten */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--lk-panel-rand)] px-4 py-3">
            <Fakt label="Von" wert={ortText(lead.ort)} hinweis={vonHinweis(lead.ort)} />
            <Fakt label="Nach" wert={ortText(lead.ziel)} hinweis={lead.ziel ? undefined : "Kein Zielort erfasst"} />
            <Fakt label="Umzug" wert={umzugText(lead.umzugAm)} />
            <Fakt
              label="Wert"
              wert={lead.wert ? euroAusCent(lead.wert.cent) : "unbekannt"}
              hinweis={lead.wert ? WERT_ART_LABEL[lead.wert.art] : undefined}
              warnung={lead.wert && plausiblerCent(lead.wert) === null ? "Wert ungewöhnlich hoch, bitte prüfen" : undefined}
            />
            {lead.bezahltCent > 0 && <Fakt label="Bezahlt" wert={euroAusCent(lead.bezahltCent)} />}
            <Fakt label="Eingang" wert={relativ(lead.angelegtAm, jetzt, true)} />
          </dl>

          {/* Schnellaktionen */}
          <div ref={aktionenRef} className="flex flex-wrap gap-2 border-t border-[var(--lk-panel-rand)] px-4 py-3">
            {vorschau ? (
              <>
                <button type="button" className={AKTION_PRIMAER} disabled title={VORSCHAU_TITEL} style={{ background: "var(--lk-aktiv)", color: "var(--lk-text-schwach)", cursor: "not-allowed" }}>
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Im Posteingang antworten
                </button>
                {lead.telefon && (
                  <button type="button" className={AKTION} disabled title={VORSCHAU_TITEL}>
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Anrufen
                  </button>
                )}
                {kvUrl && (
                  <button type="button" className={AKTION} disabled title={VORSCHAU_TITEL}>
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    KV ansehen
                  </button>
                )}
                <button type="button" className={AKTION} disabled title={VORSCHAU_TITEL}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Lead öffnen
                </button>
              </>
            ) : (
              <>
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
                {lead.telefon && telefonNummer && (
                  <a href={`tel:${telefonNummer}`} className={AKTION} title={lead.telefon}>
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
              </>
            )}
            {/* Stufe: Radix-Menü statt nativem <select>, damit Pfeiltasten nur den
                Fokus bewegen und erst Klick/Enter/Leertaste die Stufe schreibt. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`${AKTION} pr-2.5`}
                  disabled={stufeSpeichert || stufenOptionen.length === 0 || vorschau}
                  title={vorschau ? VORSCHAU_TITEL : "Stufe ändern"}
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
                  <ChatVorschau
                    lead={lead}
                    chatId={chatId}
                    onChatWechsel={chatWechseln}
                    jetzt={jetzt}
                    onGeladen={beiChatGeladen}
                    istGanzUnten={istGanzUnten}
                    ohneFuss={mobil}
                  />
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
        !vorschau &&
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
