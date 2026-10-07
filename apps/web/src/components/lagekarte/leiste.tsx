"use client";
/**
 * Lagekarte: linke Leiste. Suche, Tabs (Wartet, Heute, Alle, Ohne Ort),
 * Listen mit Tastaturnavigation (j/k, Pfeile, Enter). Rein darstellend:
 * Auswahl, Suche und Tab kommen vom Container.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Mail, MapPinOff, Phone, Search, Target, X } from "lucide-react";
import { differenceInMinutes, format, formatDistanceStrict } from "date-fns";
import { de } from "date-fns/locale";
import type { Firma, LeadPunkt, Mission } from "@/lib/lagekarte/typen";
import { FIRMEN_FALLBACK_FARBE, STATUS_STIL, WARTET_LABEL } from "@/lib/lagekarte/farben";
import { StatusForm } from "@/components/lagekarte/status-form";
import { useLagekarteThema } from "@/components/lagekarte/thema";
import { berlinDateString } from "@/lib/berlin-date";

export type LeistenTab = "wartet" | "heute" | "alle" | "ohne_ort";

export interface LeisteProps {
  leadsGefiltert: LeadPunkt[];
  missionen: Mission[];
  firmen: Firma[];
  jetzt: Date;
  auswahlId: string | null;
  onWaehle: (id: string) => void;
  suche: string;
  onSuche: (s: string) => void;
  tab: LeistenTab;
  onTab: (t: LeistenTab) => void;
  /**
   * mobil (Bottom-Sheet): ohne Glas-Rahmen, volle Breite, engere Polster,
   * ohne Tastenhinweise. Suche und Tabs bleiben, weil das Sheet sonst
   * nicht zwischen Wartet, Heute, Alle und Ohne Ort wechseln könnte
   * (Spec E15, Task 12 rendert keine eigenen Sheet-Tabs).
   */
  kompakt?: boolean;
}

/** Eine gerenderte Listenzeile. Ein Lead kann im Tab Wartet mehrfach vorkommen
 *  (wartend, E-Mail, mehrere Missionen), deshalb ist der Schlüssel `abschnitt:id`. */
interface ZeilenEintrag {
  key: string;
  leadId: string;
}

const TABS: Array<{ id: LeistenTab; label: string }> = [
  { id: "wartet", label: "Wartet" },
  { id: "heute", label: "Heute" },
  { id: "alle", label: "Alle" },
  { id: "ohne_ort", label: "Ohne Ort" },
];

const MISSIONEN_SICHTBAR = 6;
const STUNDE_MS = 60 * 60 * 1000;

/* ───────────── Hilfsfunktionen (rein) ───────────── */

function istEingabeAktiv(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return el.getAttribute("role") === "textbox";
}

/** „seit 12 Min.“, „seit 2 Std.“, „seit 3 Tagen“ */
function wartezeitText(seitIso: string, jetzt: Date): string {
  const min = Math.max(0, differenceInMinutes(jetzt, new Date(seitIso)));
  if (min < 1) return "seit kurzem";
  if (min < 60) return `seit ${min} Min.`;
  const std = Math.floor(min / 60);
  if (std < 24) return `seit ${std} Std.`;
  const tage = Math.floor(std / 24);
  return tage === 1 ? "seit 1 Tag" : `seit ${tage} Tagen`;
}

function wartetLange(seitIso: string, jetzt: Date): boolean {
  return jetzt.getTime() - new Date(seitIso).getTime() >= 24 * STUNDE_MS;
}

function zeitpunktTitel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "EEE, d. MMM HH:mm", { locale: de });
}

function eingangRelativ(iso: string, jetzt: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceStrict(d, jetzt, { locale: de, addSuffix: true });
}

function wartetGrund(lead: LeadPunkt): string {
  if (!lead.wartet) return "";
  if (lead.wartet.art === "antwort") {
    const chat = lead.chats.find((c) => c.id === lead.wartet?.chatId);
    const kanal = chat?.kanal === "sms" ? "SMS" : chat?.kanal === "email" ? "E-Mail" : "WhatsApp";
    return `${WARTET_LABEL.antwort} · ${kanal}`;
  }
  return WARTET_LABEL.neu_pruefen;
}

function ortText(lead: LeadPunkt): string {
  return lead.ort ? lead.ort.ortsname : "ohne Ort";
}

function neuesteZuerst(a: LeadPunkt, b: LeadPunkt): number {
  return b.angelegtAm.localeCompare(a.angelegtAm);
}

/** Zielindex beim Blättern: ohne aktuelle Zeile springt j auf die erste, k auf die letzte;
 *  am Rand bleibt die Auswahl stehen (kein Umlauf). */
export function zielIndex(anzahl: number, aktuell: number, richtung: 1 | -1): number {
  if (anzahl <= 0) return -1;
  if (aktuell < 0 || aktuell >= anzahl) return richtung === 1 ? 0 : anzahl - 1;
  return Math.min(anzahl - 1, Math.max(0, aktuell + richtung));
}

/** Kanonische Zeile zur Auswahl: die zuletzt per Klick oder Taste benutzte Zeile,
 *  wenn sie noch gerendert ist und zum gewählten Lead gehört, sonst das erste
 *  Vorkommen des Leads. Nur diese Zeile ist tabbar und `aria-selected`. */
export function kanonischeZeile(
  zeilen: readonly ZeilenEintrag[],
  auswahlId: string | null,
  zuletzt: ZeilenEintrag | null,
): string | null {
  if (!auswahlId) return null;
  if (zuletzt && zuletzt.leadId === auswahlId && zeilen.some((z) => z.key === zuletzt.key)) return zuletzt.key;
  return zeilen.find((z) => z.leadId === auswahlId)?.key ?? null;
}

/* ───────────── Komponente ───────────── */

export default function Leiste(p: LeisteProps) {
  const {
    leadsGefiltert,
    missionen,
    firmen,
    jetzt,
    auswahlId,
    onWaehle,
    suche,
    onSuche,
    tab,
    onTab,
    kompakt = false,
  } = p;
  const thema = useLagekarteThema();
  const sucheRef = useRef<HTMLInputElement>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  const [alleMissionen, setAlleMissionen] = useState(false);

  const firmenMap = useMemo(() => new Map(firmen.map((f) => [f.id, f])), [firmen]);
  const leadMap = useMemo(() => new Map(leadsGefiltert.map((l) => [l.id, l])), [leadsGefiltert]);

  const heute = berlinDateString(jetzt);
  const morgen = berlinDateString(new Date(jetzt.getTime() + 24 * STUNDE_MS));

  const wartend = useMemo(
    () =>
      leadsGefiltert
        .filter((l): l is LeadPunkt & { wartet: NonNullable<LeadPunkt["wartet"]> } => l.wartet !== null)
        .sort((a, b) => a.wartet.seit.localeCompare(b.wartet.seit)),
    [leadsGefiltert],
  );
  const emailUngelesen = useMemo(
    () => leadsGefiltert.filter((l) => l.emailUngelesen > 0).sort((a, b) => b.emailUngelesen - a.emailUngelesen),
    [leadsGefiltert],
  );
  const missionenSichtbar = useMemo(
    () =>
      missionen
        .filter((m) => leadMap.has(m.leadId))
        .sort((a, b) => a.dringlichkeit - b.dringlichkeit || a.titel.localeCompare(b.titel, "de")),
    [missionen, leadMap],
  );
  const heuteListe = useMemo(() => {
    const rang = (l: LeadPunkt) => (l.status === "auftrag" || l.status === "erledigt" ? 0 : 1);
    return leadsGefiltert
      .filter((l) => l.umzugAm === heute || l.umzugAm === morgen)
      .sort(
        (a, b) =>
          rang(a) - rang(b) ||
          (a.umzugAm ?? "").localeCompare(b.umzugAm ?? "") ||
          a.name.localeCompare(b.name, "de"),
      );
  }, [leadsGefiltert, heute, morgen]);
  const alleListe = useMemo(() => [...leadsGefiltert].sort(neuesteZuerst), [leadsGefiltert]);
  const ohneOrtListe = useMemo(() => leadsGefiltert.filter((l) => !l.ort).sort(neuesteZuerst), [leadsGefiltert]);

  const zahlen: Record<LeistenTab, number> = {
    wartet: wartend.length,
    heute: heuteListe.length,
    alle: alleListe.length,
    ohne_ort: ohneOrtListe.length,
  };

  /* Missionen: eingeklappt nur die ersten 6. Dieselbe Scheibe wird gerendert
     und für j/k benutzt, damit nie eine unsichtbare Zeile gewählt wird. */
  const missionenGerendert = useMemo(
    () => (alleMissionen ? missionenSichtbar : missionenSichtbar.slice(0, MISSIONEN_SICHTBAR)),
    [alleMissionen, missionenSichtbar],
  );

  /** Alle gerenderten Zeilen des aktuellen Tabs in Reihenfolge, Schlüssel `abschnitt:id`.
   *  Im Tab Wartet: Wartende, dann E-Mails, dann Missionen (ein Lead darf mehrfach vorkommen). */
  const zeilen = useMemo<ZeilenEintrag[]>(() => {
    if (tab === "wartet") {
      return [
        ...wartend.map((l) => ({ key: `wartet:${l.id}`, leadId: l.id })),
        ...emailUngelesen.map((l) => ({ key: `email:${l.id}`, leadId: l.id })),
        ...missionenGerendert.map((m) => ({ key: `mission:${m.id}`, leadId: m.leadId })),
      ];
    }
    if (tab === "heute") return heuteListe.map((l) => ({ key: `heute:${l.id}`, leadId: l.id }));
    if (tab === "alle") return alleListe.map((l) => ({ key: `alle:${l.id}`, leadId: l.id }));
    return ohneOrtListe.map((l) => ({ key: `ohne:${l.id}`, leadId: l.id }));
  }, [tab, wartend, emailUngelesen, missionenGerendert, heuteListe, alleListe, ohneOrtListe]);

  /* Zuletzt per Klick oder Taste benutzte Zeile. Bleibt nur wirksam, solange sie
     zum gewählten Lead gehört und gerendert ist (sonst erstes Vorkommen). */
  const [zuletztZeile, setZuletztZeile] = useState<ZeilenEintrag | null>(null);
  const aktiveKey = kanonischeZeile(zeilen, auswahlId, zuletztZeile);

  const waehleZeile = useCallback(
    (zeile: ZeilenEintrag) => {
      setZuletztZeile(zeile);
      if (zeile.leadId !== auswahlId) onWaehle(zeile.leadId);
    },
    [auswahlId, onWaehle],
  );

  const schritt = useCallback(
    (richtung: 1 | -1) => {
      const i = aktiveKey ? zeilen.findIndex((z) => z.key === aktiveKey) : -1;
      const ziel = zielIndex(zeilen.length, i, richtung);
      if (ziel === -1 || ziel === i) return;
      waehleZeile(zeilen[ziel]);
    },
    [zeilen, aktiveKey, waehleZeile],
  );

  /* Globale Tasten: "/" fokussiert Suche, j/k blättern. Nie in Eingabefeldern. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (istEingabeAktiv()) return;
      if (e.key === "/") {
        e.preventDefault();
        sucheRef.current?.focus();
        sucheRef.current?.select();
      } else if (e.key === "j") {
        e.preventDefault();
        schritt(1);
      } else if (e.key === "k") {
        e.preventDefault();
        schritt(-1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [schritt]);

  /* Gewählte Zeile in Sicht halten (Fokus folgt, wenn er schon in der Liste war);
     beim Tabwechsel ohne sichtbare Auswahl nach oben. */
  const vorigerTab = useRef(tab);
  useEffect(() => {
    const liste = listeRef.current;
    if (!liste) return;
    const tabGewechselt = vorigerTab.current !== tab;
    vorigerTab.current = tab;
    const zeile = aktiveKey ? liste.querySelector<HTMLElement>(`[data-zeile="${CSS.escape(aktiveKey)}"]`) : null;
    if (zeile) {
      zeile.scrollIntoView({ block: "nearest" });
      if (liste.contains(document.activeElement) && document.activeElement !== zeile) zeile.focus({ preventScroll: true });
    } else if (tabGewechselt) {
      liste.scrollTop = 0;
    }
  }, [aktiveKey, tab]);

  /* Pfeiltasten in der fokussierten Liste. */
  function onListeKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      schritt(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      schritt(-1);
    } else if (e.key === "Home" && zeilen.length > 0) {
      e.preventDefault();
      waehleZeile(zeilen[0]);
    } else if (e.key === "End" && zeilen.length > 0) {
      e.preventDefault();
      waehleZeile(zeilen[zeilen.length - 1]);
    }
  }

  function onTabsKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const n = (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    onTab(TABS[n].id);
    const knopf = e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${TABS[n].id}"]`);
    knopf?.focus();
  }

  /* Roving-Tabindex: genau eine Zeile ist tabbar (die kanonische, sonst die erste).
     Auch `aria-selected` und die Akzentkante bekommt nur die kanonische Zeile,
     selbst wenn der Lead im Tab Wartet mehrfach vorkommt. */
  const tabbareKey = aktiveKey ?? zeilen[0]?.key ?? null;

  const zeilenProps = (zeile: ZeilenEintrag) => ({
    "data-zeile": zeile.key,
    "data-lead-id": zeile.leadId,
    role: "option" as const,
    "aria-selected": zeile.key === aktiveKey,
    tabIndex: zeile.key === tabbareKey ? 0 : -1,
    gewaehlt: zeile.key === aktiveKey,
    // Klick meldet immer (auch auf den schon gewählten Lead), damit der Container
    // z. B. mobil das Panel öffnen kann; nur j/k überspringen den unveränderten Lead.
    onClick: () => {
      setZuletztZeile(zeile);
      onWaehle(zeile.leadId);
    },
  });

  return (
    <section
      aria-label="Leads"
      className={
        "flex h-full w-full min-h-0 flex-col overflow-hidden " +
        (kompakt ? "" : "lk-glas")
      }
    >
      {/* Kopf: Suche + Tabs */}
      <div className={"flex flex-col gap-2 " + (kompakt ? "px-3 pt-2 pb-1" : "px-3 pt-3 pb-2")}>
        <label className="relative block">
          <span className="sr-only">Leads durchsuchen</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--lk-text-schwach)]"
          />
          <input
            ref={sucheRef}
            type="search"
            value={suche}
            onChange={(e) => onSuche(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && suche) {
                e.preventDefault();
                onSuche("");
              } else if (e.key === "Escape") {
                e.currentTarget.blur();
              }
            }}
            placeholder="Name, Nummer, PLZ"
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-[var(--lk-panel-rand)] bg-[var(--lk-panel-2)] pl-9 pr-10 text-[14px] text-[var(--lk-text)] placeholder:text-[var(--lk-text-schwach)] outline-none transition-[box-shadow,border-color] focus-visible:border-[var(--lk-akzent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--lk-akzent)_45%,transparent)] [&::-webkit-search-cancel-button]:hidden"
          />
          {suche ? (
            <button
              type="button"
              onClick={() => {
                onSuche("");
                sucheRef.current?.focus();
              }}
              aria-label="Suche leeren"
              className="absolute right-0.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--lk-text-leise)] hover:bg-[var(--lk-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)]"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : (
            !kompakt && (
              <kbd
                aria-hidden="true"
                className="k-mono pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-[var(--lk-panel-rand)] bg-[var(--lk-panel)] px-1.5 py-0.5 text-[11px] leading-none text-[var(--lk-text-schwach)]"
              >
                /
              </kbd>
            )
          )}
        </label>

        <div
          role="tablist"
          aria-label="Listen"
          onKeyDown={onTabsKey}
          className="grid grid-cols-4 gap-1 rounded-xl bg-[var(--lk-panel-2)] p-1"
        >
          {TABS.map((t) => {
            const aktiv = t.id === tab;
            const n = zahlen[t.id];
            const warnen = t.id === "wartet" && n > 0;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                aria-selected={aktiv}
                aria-controls="lk-leiste-panel"
                tabIndex={aktiv ? 0 : -1}
                onClick={() => onTab(t.id)}
                className={
                  "flex h-9 min-w-0 flex-col items-center justify-center rounded-lg px-1 leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)] " +
                  (aktiv
                    ? "bg-[var(--lk-panel)] text-[var(--lk-text)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-[var(--lk-text-leise)] hover:bg-[var(--lk-hover)] hover:text-[var(--lk-text)]")
                }
              >
                <span className="truncate text-[12px] font-medium">{t.label}</span>
                <span
                  className={
                    "k-mono mt-1 text-[11px] tabular-nums " +
                    (warnen ? "font-semibold text-[var(--lk-wartet)]" : aktiv ? "text-[var(--lk-text-leise)]" : "text-[var(--lk-text-schwach)]")
                  }
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Liste */}
      <div
        ref={listeRef}
        id="lk-leiste-panel"
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === tab)?.label}
        onKeyDown={onListeKey}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 focus-visible:outline-none [scrollbar-width:thin]"
      >
        {tab === "wartet" && (
          <>
            <Abschnitt titel="Wartet auf uns" anzahl={wartend.length}>
              {wartend.length === 0 ? (
                <Leer>Niemand wartet. Stark.</Leer>
              ) : (
                <div role="listbox" aria-label="Wartende Leads">
                  {wartend.map((l) => (
                    <Zeile key={l.id} {...zeilenProps({ key: `wartet:${l.id}`, leadId: l.id })}>
                      <StatusForm status={l.status} thema={thema} groesse={16} wartet />
                      <ZeilenText titel={l.name} unten={`${wartetGrund(l)} · ${ortText(l)}`} />
                      <Wartezeit seit={l.wartet.seit} jetzt={jetzt} />
                    </Zeile>
                  ))}
                </div>
              )}
            </Abschnitt>

            {emailUngelesen.length > 0 && (
              <Abschnitt titel="E-Mails ungelesen (Antwortstatus unbekannt)" anzahl={emailUngelesen.length}>
                <div role="listbox" aria-label="Leads mit ungelesenen E-Mails">
                  {emailUngelesen.map((l) => (
                    <Zeile key={l.id} {...zeilenProps({ key: `email:${l.id}`, leadId: l.id })}>
                      <StatusForm status={l.status} thema={thema} groesse={16} />
                      <ZeilenText
                        titel={l.name}
                        unten={`${l.emailUngelesen} ungelesen · ${ortText(l)}`}
                      />
                      <Mail className="size-4 shrink-0 text-[var(--lk-text-schwach)]" aria-hidden="true" />
                    </Zeile>
                  ))}
                </div>
              </Abschnitt>
            )}

            {missionenSichtbar.length > 0 && (
              <Abschnitt titel="Missionen" anzahl={missionenSichtbar.length}>
                <div role="listbox" aria-label="Missionen">
                  {missionenGerendert.map((m) => {
                    const lead = leadMap.get(m.leadId);
                    if (!lead) return null;
                    return (
                      <Zeile key={m.id} {...zeilenProps({ key: `mission:${m.id}`, leadId: m.leadId })}>
                        <span
                          aria-hidden="true"
                          className={
                            "flex size-4 shrink-0 items-center justify-center " +
                            (m.dringlichkeit === 1 ? "text-[var(--lk-wartet)]" : m.dringlichkeit === 2 ? "text-[var(--lk-warn)]" : "text-[var(--lk-text-schwach)]")
                          }
                        >
                          <Target className="size-4" />
                        </span>
                        <ZeilenText titel={m.titel} unten={`${lead.name} · ${ortText(lead)}`} />
                      </Zeile>
                    );
                  })}
                </div>
                {missionenSichtbar.length > MISSIONEN_SICHTBAR && (
                  <button
                    type="button"
                    onClick={() => setAlleMissionen((v) => !v)}
                    aria-expanded={alleMissionen}
                    className="mx-3 mt-1 flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-[var(--lk-text-leise)] hover:bg-[var(--lk-hover)] hover:text-[var(--lk-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)]"
                  >
                    {alleMissionen ? (
                      <>
                        <ChevronUp className="size-4" aria-hidden="true" /> Weniger anzeigen
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-4" aria-hidden="true" /> Alle anzeigen ({missionenSichtbar.length})
                      </>
                    )}
                  </button>
                )}
              </Abschnitt>
            )}
          </>
        )}

        {tab === "heute" && (
          <Abschnitt titel="Umzüge heute und morgen" anzahl={heuteListe.length}>
            {heuteListe.length === 0 ? (
              <Leer>Heute und morgen steht kein Umzug an.</Leer>
            ) : (
              <div role="listbox" aria-label="Umzüge heute und morgen">
                {heuteListe.map((l) => {
                  const wann = l.umzugAm === heute ? "Heute" : "Morgen";
                  const firma = l.firmaId ? firmenMap.get(l.firmaId) : undefined;
                  return (
                    <div key={l.id} className="flex items-stretch">
                      <Zeile {...zeilenProps({ key: `heute:${l.id}`, leadId: l.id })} className="min-w-0 flex-1">
                        <span
                          className={
                            "flex shrink-0 items-center gap-1 " +
                            (wann === "Heute" ? "text-[var(--lk-ok)]" : "text-[var(--lk-text-leise)]")
                          }
                        >
                          <Clock className="size-4" aria-hidden="true" />
                          <span className="k-mono w-[52px] text-[11px] font-medium uppercase tracking-[0.08em]">{wann}</span>
                        </span>
                        <ZeilenText
                          titel={l.name}
                          unten={`${STATUS_STIL[l.status].kurz} · ${ortText(l)}${l.ziel ? ` → ${l.ziel.ortsname}` : ""}`}
                        />
                        {firma && <FirmaBadge firma={firma} />}
                      </Zeile>
                      {l.telefon && (
                        <a
                          href={`tel:${l.telefon.replace(/\s+/g, "")}`}
                          aria-label={`${l.name} anrufen`}
                          title={l.telefon}
                          className="mr-2 flex w-10 shrink-0 items-center justify-center self-center rounded-lg text-[var(--lk-ok)] hover:bg-[var(--lk-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)]"
                          style={{ height: 40 }}
                        >
                          <Phone className="size-4" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Abschnitt>
        )}

        {tab === "alle" && (
          <Abschnitt titel="Alle Leads im Filter" anzahl={alleListe.length}>
            {alleListe.length === 0 ? (
              <Leer>{suche ? `Nichts gefunden für „${suche}“.` : "Keine Leads im aktuellen Filter."}</Leer>
            ) : (
              <div role="listbox" aria-label="Alle Leads">
                {alleListe.map((l) => (
                  <LeadZeile key={l.id} lead={l} jetzt={jetzt} {...zeilenProps({ key: `alle:${l.id}`, leadId: l.id })} />
                ))}
              </div>
            )}
          </Abschnitt>
        )}

        {tab === "ohne_ort" && (
          <>
            <p className="mx-3 mt-2 mb-1 flex gap-2 rounded-lg bg-[var(--lk-panel-2)] px-3 py-2 text-[12.5px] leading-snug text-[var(--lk-text-leise)]">
              <MapPinOff className="mt-0.5 size-4 shrink-0 text-[var(--lk-text-schwach)]" aria-hidden="true" />
              <span>Diese Leads haben noch keine verwertbare Adresse. Adresse erfragen oder im Lead eintragen.</span>
            </p>
            <Abschnitt titel="Ohne Ort" anzahl={ohneOrtListe.length}>
              {ohneOrtListe.length === 0 ? (
                <Leer>Alle Leads haben einen Ort.</Leer>
              ) : (
                <div role="listbox" aria-label="Leads ohne Ort">
                  {ohneOrtListe.map((l) => (
                    <LeadZeile key={l.id} lead={l} jetzt={jetzt} ohneOrt {...zeilenProps({ key: `ohne:${l.id}`, leadId: l.id })} />
                  ))}
                </div>
              )}
            </Abschnitt>
          </>
        )}
      </div>

      {!kompakt && (
        <p
          aria-hidden="true"
          className="k-mono shrink-0 border-t border-[var(--lk-panel-rand)] px-3 py-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--lk-text-schwach)]"
        >
          j k blättern · Enter öffnet · / suchen
        </p>
      )}
    </section>
  );
}

/* ───────────── Bausteine ───────────── */

function Abschnitt({ titel, anzahl, children }: { titel: string; anzahl: number; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <h3 className="k-label flex items-baseline justify-between px-4 pb-1" style={{ color: "var(--lk-text-schwach)" }}>
        <span>{titel}</span>
        <span className="tabular-nums">{anzahl}</span>
      </h3>
      {children}
    </div>
  );
}

function Leer({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-4 text-[13px] text-[var(--lk-text-leise)]">{children}</p>;
}

interface ZeileProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  gewaehlt: boolean;
  className?: string;
}

/** Listenzeile, 52 px, aktive Zeile mit 3-px-Akzentkante links. */
function Zeile({ gewaehlt, className = "", children, ...rest }: ZeileProps) {
  return (
    <button
      type="button"
      {...rest}
      className={
        "flex w-full items-center gap-3 px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lk-akzent)] " +
        (gewaehlt ? "bg-[var(--lk-aktiv)]" : "hover:bg-[var(--lk-hover)]") +
        " " +
        className
      }
      style={{
        height: 52,
        boxShadow: gewaehlt ? "inset 3px 0 0 0 var(--lk-akzent)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

function ZeilenText({ titel, unten }: { titel: string; unten: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-[14px] font-medium leading-tight text-[var(--lk-text)]">{titel}</span>
      <span className="truncate text-[12px] leading-tight text-[var(--lk-text-leise)]">{unten}</span>
    </span>
  );
}

function Wartezeit({ seit, jetzt }: { seit: string; jetzt: Date }) {
  const lange = wartetLange(seit, jetzt);
  return (
    <span
      title={zeitpunktTitel(seit)}
      className={
        "k-mono shrink-0 text-[11.5px] tabular-nums " +
        (lange ? "font-semibold text-[var(--lk-wartet)]" : "text-[var(--lk-text-leise)]")
      }
    >
      {wartezeitText(seit, jetzt)}
    </span>
  );
}

function FirmaBadge({ firma }: { firma: Firma }) {
  return (
    <span
      role="img"
      title={firma.name}
      aria-label={firma.name}
      className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: firma.farbe || FIRMEN_FALLBACK_FARBE }}
    >
      {firma.kurz}
    </span>
  );
}

type LeadZeileProps = { lead: LeadPunkt; jetzt: Date; ohneOrt?: boolean } & Omit<ZeileProps, "children">;

/** Zeile für „Alle“ und „Ohne Ort“: Statusform, Name, Nummer, Status und Ort, Eingang rechts. */
function LeadZeile({ lead, jetzt, ohneOrt = false, ...rest }: LeadZeileProps) {
  const thema = useLagekarteThema();
  const ort = ohneOrt ? (lead.ziel ? `Ziel ${lead.ziel.ortsname}` : "keine Adresse") : ortText(lead);
  return (
    <Zeile {...rest}>
      <StatusForm status={lead.status} thema={thema} groesse={16} wartet={lead.wartet !== null} />
      <ZeilenText
        titel={lead.name}
        unten={`${lead.nummer ? `${lead.nummer} · ` : ""}${STATUS_STIL[lead.status].kurz} · ${ort}`}
      />
      <span
        title={zeitpunktTitel(lead.angelegtAm)}
        className="k-mono shrink-0 text-[11px] tabular-nums text-[var(--lk-text-schwach)]"
      >
        {eingangRelativ(lead.angelegtAm, jetzt)}
      </span>
    </Zeile>
  );
}
