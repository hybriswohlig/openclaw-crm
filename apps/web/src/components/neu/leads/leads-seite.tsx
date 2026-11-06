"use client";

import "@/styles/neu-leads.css";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { TerminDialogAlt } from "@/components/neu/akte/termin-dialog-alt";
import { useBreit } from "@/components/neu/breit";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import {
  LEADS_ANSICHT_SCHLUESSEL,
  LISTEN_SEITE,
  STANDARD_ANSICHT,
  filterAusParams,
  leadsAnsichtAus,
  type LeadKarte,
  type LeadsAnsicht,
  type LeadsBoard as Board,
  type LeadsChips,
  type LeadsFilter,
  type LeadsListe as Liste,
  type LeadsSpaltenSeite,
  type LeadsStammdaten,
  type ListenSortierung,
  type ListenSpalte,
  type SortSchluessel,
} from "@/lib/leads-board";
import { akteUrl } from "./lead-karte";
import { LeadsBoard } from "./leads-board";
import { LeadsChipsZeile } from "./leads-chips";
import { LeadsHandy } from "./leads-handy";
import { LeadsKopf } from "./leads-kopf";
import { LeadsLeiste } from "./leads-leiste";
import { LeadsListe } from "./leads-liste";
import {
  boardUrl,
  filterWirksam,
  kartenMischen,
  leadsUrl,
  leerText,
  listeUrl,
  modusAnzeige,
  nachladeLimits,
  nachladen,
  seitenEinsetzen,
  sortierungKlick,
  spalteUmschalten,
  spalteUrl,
  spaltenNachAktion,
  terminFehlt,
  zugBauen,
  type Zug,
  type ZugSeite,
} from "./leads-logik";
import { ZahlungAusAkte, ZugDialoge, type ZugErgebnis } from "./zug-dialoge";

/** Board bzw. Liste alle 60 s still neu (Entscheidung 18). */
const TAKT_MS = 60_000;
/** Die Suche wartet so lange auf weitere Zeichen, bevor sie zum Server geht. */
const SUCHE_VERZUG_MS = 250;
/** Die Ansicht wird so lange nach der letzten Änderung gespeichert (Entscheidung 16). */
const ANSICHT_VERZUG_MS = 500;

type Grund = "oeffnen" | "aktion" | "takt";
type BoardZustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; board: Board };
type ListeZustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; liste: Liste };
type Dialog = { art: "termin"; dealId: string } | { art: "zahlung"; karte: LeadKarte };

const FILTER_RUECKSETZEN: Partial<LeadsFilter> = { chip: null, firmaId: null, quelleId: null, monat: null, suche: "", nurWartet: false };

/**
 * /app/leads (Plan 7): Board oder Liste über alle Deals des Workspace. Hält
 * die Filter (in der URL, nicht gespeichert), die gespeicherte Ansicht
 * (`user_settings.ansichten.leads`, 500 ms nach der letzten Änderung), lädt
 * Board (`/leads/board`, je Spalte „Mehr laden“ über `/leads/board/spalte`)
 * bzw. Liste (`/leads/liste`) beim Öffnen, bei Filteränderung und alle 60 s
 * (nur sichtbarer Tab, nicht während eines Zugs oder Dialogs). Züge laufen
 * über `ZugDialoge`; nichts wird optimistisch verschoben.
 */
export function LeadsSeite() {
  const router = useRouter();
  const params = useSearchParams();
  const breit = useBreit();
  const portalZiel = usePortalZiel();

  const [filter, setFilter] = useState<LeadsFilter>(() => filterAusParams(new URLSearchParams(params.toString())));
  const [gesendet, setGesendet] = useState<LeadsFilter>(() => filterWirksam(filter));
  const [ansicht, setAnsicht] = useState<LeadsAnsicht | null>(null);
  const [board, setBoard] = useState<BoardZustand>({ art: "laden" });
  const [liste, setListe] = useState<ListeZustand>({ art: "laden" });
  const [chips, setChips] = useState<LeadsChips | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [zug, setZug] = useState<Zug | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [nachladend, setNachladend] = useState<ReadonlySet<string>>(new Set());
  const [listeLaedtMehr, setListeLaedtMehr] = useState(false);

  const boardLauf = useRef(0);
  const listeLauf = useRef(0);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board.art === "fertig" ? board.board : null;
  const listeRef = useRef<Liste | null>(null);
  listeRef.current = liste.art === "fertig" ? liste.liste : null;
  const gesendetRef = useRef(gesendet);
  gesendetRef.current = gesendet;
  const ansichtRef = useRef(ansicht);
  ansichtRef.current = ansicht;
  const pausiert = useRef(false);
  pausiert.current = zug !== null || dialog !== null;
  const ansichtGeladen = useRef(false);

  const modus = ansicht ? modusAnzeige(ansicht) : "board";
  const sortierung = ansicht?.sortierung ?? STANDARD_ANSICHT.sortierung;

  // ── Gespeicherte Ansicht ───────────────────────────────────────────────────

  useEffect(() => {
    let aktiv = true;
    void apiAufruf<{ ansichten?: Record<string, unknown> }>("/api/v1/me/settings").then((r) => {
      if (!aktiv) return;
      setAnsicht(leadsAnsichtAus(r.ok ? r.data?.ansichten?.[LEADS_ANSICHT_SCHLUESSEL] : undefined));
      // Erst ab der nächsten Änderung speichern.
      window.setTimeout(() => {
        ansichtGeladen.current = true;
      }, 0);
    });
    return () => {
      aktiv = false;
    };
  }, []);

  useEffect(() => {
    if (!ansicht || !ansichtGeladen.current) return;
    const t = window.setTimeout(() => {
      void apiAufruf<unknown>(`/api/v1/me/ansichten/${LEADS_ANSICHT_SCHLUESSEL}`, jsonAufruf("PUT", ansicht)).then((r) => {
        if (!r.ok) toast.message("Ansicht nicht gespeichert.", { description: r.message });
      });
    }, ANSICHT_VERZUG_MS);
    return () => window.clearTimeout(t);
  }, [ansicht]);

  // ── Filter: URL und verzögerte Suche ──────────────────────────────────────

  useEffect(() => {
    const url = leadsUrl(filter);
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [filter]);

  // Zurück und Vor lesen die Filter wieder aus der URL.
  useEffect(() => {
    const lesen = () => setFilter(filterAusParams(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", lesen);
    return () => window.removeEventListener("popstate", lesen);
  }, []);

  useEffect(() => {
    const neu = filterWirksam(filter);
    const nurSuche = JSON.stringify({ ...neu, suche: "" }) === JSON.stringify({ ...gesendetRef.current, suche: "" });
    const t = window.setTimeout(
      () => setGesendet((alt) => (JSON.stringify(alt) === JSON.stringify(neu) ? alt : neu)),
      nurSuche && neu.suche !== gesendetRef.current.suche ? SUCHE_VERZUG_MS : 0
    );
    return () => window.clearTimeout(t);
  }, [filter]);

  // ── Laden ──────────────────────────────────────────────────────────────────

  const boardLaden = useCallback(async (f: LeadsFilter, grund: Grund, behalten: boolean) => {
    const dieser = ++boardLauf.current;
    const limits = behalten ? nachladeLimits(boardRef.current?.spalten ?? []) : [];
    if (grund === "oeffnen") setLaedt(true);
    const [b, ...seiten] = await Promise.all([
      apiAufruf<Board>(boardUrl(f)),
      ...limits.map((l) => apiAufruf<LeadsSpaltenSeite>(spalteUrl(f, l.stufeId, 0, l.limit))),
    ]);
    if (dieser !== boardLauf.current) return;
    setLaedt(false);
    setNachladend(new Set());
    if (!b.ok) {
      if (boardRef.current) {
        if (grund === "aktion") toast.error("Leads konnten nicht neu geladen werden.", { description: b.message });
        return;
      }
      setBoard({ art: "fehler", meldung: b.message });
      return;
    }
    const ok = seiten.flatMap((s) => (s.ok ? [s.data] : []));
    setBoard({ art: "fertig", board: seitenEinsetzen(b.data, ok) });
    setChips(b.data.chips);
  }, []);

  const listeLaden = useCallback(async (f: LeadsFilter, s: ListenSortierung, grund: Grund, behalten: boolean) => {
    const dieser = ++listeLauf.current;
    const geladen = behalten ? (listeRef.current?.zeilen.length ?? 0) : 0;
    const seiten = Math.max(1, Math.ceil(geladen / LISTEN_SEITE));
    if (grund === "oeffnen") setLaedt(true);
    const antworten = await Promise.all(Array.from({ length: seiten }, (_, i) => apiAufruf<Liste>(listeUrl(f, s, i * LISTEN_SEITE))));
    if (dieser !== listeLauf.current) return;
    setLaedt(false);
    const erste = antworten[0]!;
    if (!erste.ok) {
      if (listeRef.current) {
        if (grund === "aktion") toast.error("Leads konnten nicht neu geladen werden.", { description: erste.message });
        return;
      }
      setListe({ art: "fehler", meldung: erste.message });
      return;
    }
    let zeilen = erste.data.zeilen;
    let weiter = erste.data.weiter;
    for (const a of antworten.slice(1)) {
      if (!a.ok) break;
      zeilen = kartenMischen(zeilen, a.data.zeilen);
      weiter = a.data.weiter;
    }
    setListe({ art: "fertig", liste: { ...erste.data, zeilen, weiter } });
    setChips(erste.data.chips);
  }, []);

  /** Die aktive Ansicht neu laden, geladene Karten behalten (nach Aktionen und im Takt). */
  const neuLaden = useCallback(
    (grund: Grund = "aktion") => {
      const a = ansichtRef.current;
      if (!a) return Promise.resolve();
      return modusAnzeige(a) === "liste"
        ? listeLaden(gesendetRef.current, a.sortierung, grund, true)
        : boardLaden(gesendetRef.current, grund, true);
    },
    [boardLaden, listeLaden]
  );

  // Beim Öffnen, bei neuen Filtern, neuer Sortierung und beim Umschalten.
  const ladeKey = ansicht ? JSON.stringify([gesendet, modus, sortierung]) : null;
  useEffect(() => {
    if (!ladeKey || !ansicht) return;
    if (modus === "liste") void listeLaden(gesendet, sortierung, "oeffnen", false);
    else void boardLaden(gesendet, "oeffnen", false);
    // Nur der Schlüssel zählt; die Objekte dahinter sind daraus abgeleitet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladeKey, boardLaden, listeLaden]);

  // Takt: nur bei sichtbarem Tab und ohne laufenden Zug oder Dialog; beim Zurückkehren sofort.
  useEffect(() => {
    const takt = () => {
      if (document.hidden || pausiert.current) return;
      void neuLaden("takt");
    };
    const id = window.setInterval(takt, TAKT_MS);
    document.addEventListener("visibilitychange", takt);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", takt);
    };
  }, [neuLaden]);

  // ── Mehr laden ─────────────────────────────────────────────────────────────

  const mehrLaden = useCallback(async (stufeId: string) => {
    const b = boardRef.current;
    const sp = b?.spalten.find((s) => s.stufeId === stufeId);
    if (!sp || sp.weiter === null) return;
    const lauf = boardLauf.current;
    setNachladend((n) => new Set(n).add(stufeId));
    const r = await apiAufruf<LeadsSpaltenSeite>(spalteUrl(gesendetRef.current, stufeId, sp.weiter));
    setNachladend((n) => {
      const neu = new Set(n);
      neu.delete(stufeId);
      return neu;
    });
    if (lauf !== boardLauf.current) return;
    if (!r.ok) {
      toast.error("Mehr konnte nicht geladen werden.", { description: r.message });
      return;
    }
    setBoard((z) =>
      z.art === "fertig"
        ? { art: "fertig", board: { ...z.board, spalten: z.board.spalten.map((s) => (s.stufeId === stufeId ? nachladen(s, r.data) : s)) } }
        : z
    );
  }, []);

  const listeMehr = useCallback(async () => {
    const l = listeRef.current;
    const a = ansichtRef.current;
    if (!l || l.weiter === null || !a) return;
    const lauf = listeLauf.current;
    setListeLaedtMehr(true);
    const r = await apiAufruf<Liste>(listeUrl(gesendetRef.current, a.sortierung, l.weiter));
    setListeLaedtMehr(false);
    if (lauf !== listeLauf.current) return;
    if (!r.ok) {
      toast.error("Mehr konnte nicht geladen werden.", { description: r.message });
      return;
    }
    setListe((z) =>
      z.art === "fertig"
        ? { art: "fertig", liste: { ...r.data, zeilen: kartenMischen(z.liste.zeilen, r.data.zeilen) } }
        : z
    );
  }, []);

  // ── Züge und Dialoge ───────────────────────────────────────────────────────

  const zugStarten = useCallback((karte: LeadKarte, von: ZugSeite, nach: ZugSeite) => {
    const z = zugBauen(karte, von, nach);
    if (z) setZug(z);
  }, []);

  const zugEnde = useCallback(
    (e: ZugErgebnis) => {
      const z = zug;
      setZug(null);
      if (!z) return;
      // Nach Abbruch oder Fehler steht der Fokus sonst auf dem Body (das Menü ist zu, der Dialog weg).
      if (!e.stufeGesetzt) fokusZurKarte(z.karte.id);
      if (e.stufeGesetzt) {
        setNachladend(new Set(spaltenNachAktion(z.von.stufeId, z.nach.stufeId)));
        if (terminFehlt(z.karte, z.nach.kategorie, true)) {
          toast.success(`Stufe auf „${z.nach.label}“ gesetzt.`, {
            description: "Noch kein Termin.",
            // Mit Knopf: länger als die üblichen 4 s, damit man ihn noch erreicht.
            duration: 10_000,
            action: { label: "Termin festlegen", onClick: () => setDialog({ art: "termin", dealId: z.karte.id }) },
          });
        } else {
          toast.success(`Stufe auf „${z.nach.label}“ gesetzt.`);
        }
      }
      if (e.neuLaden) void neuLaden();
    },
    [zug, neuLaden]
  );

  const filterSetzen = useCallback((teil: Partial<LeadsFilter>) => setFilter((f) => ({ ...f, ...teil })), []);
  const oeffnen = useCallback((k: LeadKarte) => router.push(akteUrl(k.id)), [router]);
  const zahlungGemeldet = useCallback((k: LeadKarte) => setDialog({ art: "zahlung", karte: k }), []);
  const ansichtSetzen = useCallback((f: (a: LeadsAnsicht) => LeadsAnsicht) => setAnsicht((a) => (a ? f(a) : a)), []);

  const stamm: LeadsStammdaten | null = useMemo(() => {
    if (board.art === "fertig") return board.board;
    if (liste.art === "fertig") return liste.liste;
    return null;
  }, [board, liste]);

  if (breit === null || ansicht === null) return <LeadsSkelett />;

  const dialoge = (
    <>
      {zug && stamm ? (
        <ZugDialoge key={`${zug.karte.id}:${zug.nach.stufeId}`} zug={zug} stammdaten={stamm} portalZiel={portalZiel} onEnde={zugEnde} />
      ) : null}
      {dialog?.art === "termin" ? (
        <TerminDialogAlt
          dealId={dialog.dealId}
          portalZiel={portalZiel}
          onSchliessen={() => {
            setDialog(null);
            void neuLaden();
          }}
        />
      ) : null}
      {dialog?.art === "zahlung" ? (
        <ZahlungAusAkte
          dealId={dialog.karte.id}
          portalZiel={portalZiel}
          onSchliessen={(e) => {
            setDialog(null);
            if (e.geaendert) void neuLaden();
          }}
        />
      ) : null}
    </>
  );

  // Handy (Entscheidung 17): Kartenliste ohne Ziehen; die gespeicherte Ansicht bleibt unberührt.
  if (!breit) {
    return (
      <>
        <LeadsHandy
          zustand={board}
          chips={chips}
          filter={filter}
          nachladend={nachladend}
          onFilter={filterSetzen}
          onMehr={(id) => void mehrLaden(id)}
          onErneut={() => void boardLaden(gesendet, "oeffnen", false)}
          onOeffnen={oeffnen}
          onZahlungGemeldet={zahlungGemeldet}
        />
        {dialoge}
      </>
    );
  }

  const leer = board.art === "fertig" && modus === "board" ? leerText(board.board.spalten, gesendet) : null;

  return (
    <div className="leads" data-laedt={laedt || undefined}>
      <LeadsKopf />
      <LeadsChipsZeile chips={chips} aktiv={filter.chip} kompakt={false} onWaehlen={(chip) => filterSetzen({ chip })} />
      <LeadsLeiste
        filter={filter}
        modus={modus}
        firmen={stamm?.firmen ?? []}
        quellen={stamm?.quellen ?? []}
        kompakt={false}
        onFilter={filterSetzen}
        onModus={(m) => ansichtSetzen((a) => ({ ...a, modus: m }))}
      />

      {modus === "board" ? (
        board.art === "laden" ? (
          <BoardSkelett />
        ) : board.art === "fehler" ? (
          <Hinweis text={`Leads konnten nicht geladen werden. ${board.meldung}`} rolle="alert">
            <GlassButton size="sm" onClick={() => void boardLaden(gesendet, "oeffnen", false)}>
              Erneut versuchen
            </GlassButton>
          </Hinweis>
        ) : leer ? (
          <Hinweis text={leer === "keine" ? "Noch keine Leads." : "Keine Treffer für diese Filter."}>
            {leer === "treffer" ? (
              <GlassButton size="sm" onClick={() => filterSetzen(FILTER_RUECKSETZEN)}>
                Filter zurücksetzen
              </GlassButton>
            ) : null}
          </Hinweis>
        ) : (
          <LeadsBoard
            board={board.board}
            zug={zug}
            nachladend={nachladend}
            onZug={zugStarten}
            onMehr={(id) => void mehrLaden(id)}
            onEndstufen={(zeigen) => filterSetzen({ endstufen: zeigen })}
            onOeffnen={oeffnen}
            onZahlungGemeldet={zahlungGemeldet}
          />
        )
      ) : liste.art === "laden" ? (
        <span className="lg-skeleton leads-skelett-liste" aria-busy="true" aria-label="Liste wird geladen" />
      ) : liste.art === "fehler" ? (
        <Hinweis text={`Leads konnten nicht geladen werden. ${liste.meldung}`} rolle="alert">
          <GlassButton size="sm" onClick={() => void listeLaden(gesendet, sortierung, "oeffnen", false)}>
            Erneut versuchen
          </GlassButton>
        </Hinweis>
      ) : liste.liste.gesamt === 0 && leerText([], gesendet) === "treffer" ? (
        <Hinweis text="Keine Treffer für diese Filter.">
          <GlassButton size="sm" onClick={() => filterSetzen(FILTER_RUECKSETZEN)}>
            Filter zurücksetzen
          </GlassButton>
        </Hinweis>
      ) : (
        <LeadsListe
          liste={liste.liste}
          ansicht={ansicht}
          endstufen={filter.endstufen}
          laedtMehr={listeLaedtMehr}
          onSortieren={(s: SortSchluessel) => ansichtSetzen((a) => sortierungKlick(a, s))}
          onSpalte={(k: ListenSpalte) => ansichtSetzen((a) => spalteUmschalten(a, k))}
          onMehr={() => void listeMehr()}
          onEndstufen={(zeigen) => filterSetzen({ endstufen: zeigen })}
          onOeffnen={oeffnen}
        />
      )}

      {dialoge}
    </div>
  );
}

/**
 * Fokus zurück auf das Menü „Stufe ändern“ der Karte, wenn er nirgends steht.
 * Etwas später als der Dialog, der beim Schließen selbst noch fokussiert.
 */
function fokusZurKarte(dealId: string) {
  window.setTimeout(() => {
    const aktiv = document.activeElement;
    if (aktiv && aktiv !== document.body) return;
    document.querySelector<HTMLElement>(`.leads-karte[data-karte="${CSS.escape(dealId)}"] .leads-karte-menue`)?.focus();
  }, 50);
}

function Hinweis({ text, rolle, children }: { text: string; rolle?: "alert"; children?: React.ReactNode }) {
  return (
    <div className="leads-hinweis" role={rolle}>
      <p>{text}</p>
      {children}
    </div>
  );
}

function BoardSkelett() {
  return (
    <div className="leads-board leads-board-skelett" aria-busy="true" aria-label="Board wird geladen">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="leads-spalte">
          <span className="lg-skeleton leads-skelett-kopf" data-variant="line" />
          <span className="lg-skeleton leads-skelett-karte" />
          <span className="lg-skeleton leads-skelett-karte" />
        </div>
      ))}
    </div>
  );
}

function LeadsSkelett() {
  return (
    <div className="leads" aria-busy="true" aria-label="Leads werden geladen">
      <LeadsKopf />
      <span className="lg-skeleton leads-skelett-zeile" />
      <span className="lg-skeleton leads-skelett-leiste" />
      <BoardSkelett />
    </div>
  );
}
