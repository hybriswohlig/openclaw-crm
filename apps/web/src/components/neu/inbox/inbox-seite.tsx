"use client";

import "@/styles/neu-inbox.css";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { ComposeWhatsAppModal, type ChannelAccount } from "@/components/inbox/compose-whatsapp-modal";
import { apiAufruf } from "@/components/neu/akte/api";
import { useBreit } from "@/components/neu/breit";
import { nachVerfassenSchluessel, verfassenAus, type VerfassenVorgabe } from "@/lib/handy-links";
import type { InboxChips, InboxFilter, InboxListe, Kurzfassung } from "@/lib/inbox-neu";
import { KV_NACHRICHT_PARAM } from "@/lib/kv-danach";
import { textKopieren } from "@/components/neu/kv-danach/status-link";
import type { Gespraech } from "@/services/gespraech";
import { InboxChipsZeile } from "./inbox-chips";
import { InboxLeiste } from "./inbox-leiste";
import { InboxListe as InboxListePanel } from "./inbox-liste";
import {
  FILTER_LEER,
  gelesenAnwenden,
  gespraechUrl,
  gruppieren,
  handyUnterzeile,
  inboxUrl,
  ladeFehlerFolge,
  schluesselAus,
  sucheAktiv,
  type LadeGrund,
  type Schluessel,
} from "./inbox-logik";
import { InboxMitte, type KvAuftrag } from "./inbox-mitte";
import { KontaktKarte } from "./kontakt-karte";
import { KurzfassungSpalte } from "./kurzfassung-spalte";
import { useLaneAktionen } from "./lane-aktionen";

/** Liste und offenes Gespräch alle 60 s still neu (Entscheidung 14). */
const TAKT_MS = 60_000;
/** Die Suche wartet so lange auf weitere Zeichen, bevor sie zum Server geht. */
const SUCHE_VERZUG_MS = 250;

type Grund = LadeGrund;

/** Abfrage-Schlüssel von `verfassenUrl` (lib/handy-links.ts); nach dem Öffnen abgeräumt. */
const VERFASSEN_PARAMS = ["verfassen", "kanal", "telefon", "name", "deal"] as const;

const LEERE_VORGABE: VerfassenVorgabe = { channelAccountId: null, telefon: null, name: null, dealRecordId: null };

type VerfassenZustand =
  | { art: "zu" }
  | { art: "laden"; vorgabe: VerfassenVorgabe; text?: string }
  | { art: "offen"; vorgabe: VerfassenVorgabe; konten: ChannelAccount[]; text?: string };

type ListeZustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; liste: InboxListe };

type MitteZustand =
  | { art: "leer" }
  | { art: "laden" }
  | { art: "fehler"; meldung: string; status: number }
  | { art: "fertig"; gespraech: Gespraech; kurz: Kurzfassung | null };

/**
 * /app/inbox (Plan 6): die Warteschlange über alle Deals. Lädt die Liste
 * (`GET /inbox/liste`, bei Suche mit `q`), hält Filter und Auswahl (`?e=`),
 * lädt zum gewählten Eintrag das Gespräch (Deal: `/deals/{id}/gespraech`,
 * sonst `/inbox/gespraeche/{id}`) und die Deal-Kurzfassung. Beides alle 60 s
 * still neu, nicht bei verstecktem Tab; nach jeder Aktion sofort. Die Chips
 * zeigen den Gesamtstand der letzten Ladung ohne Suche.
 */
export function InboxSeite() {
  const params = useSearchParams();
  const eParam = params.get("e");
  const breit = useBreit();
  const [filter, setFilter] = useState<InboxFilter>(FILTER_LEER);
  const [liste, setListe] = useState<ListeZustand>({ art: "laden" });
  const [chipsGesamt, setChipsGesamt] = useState<InboxChips | null>(null);
  const [mitte, setMitte] = useState<MitteZustand>({ art: "leer" });
  const [infoOffen, setInfoOffen] = useState(false);
  const [verfassen, setVerfassen] = useState<VerfassenZustand>({ art: "zu" });
  /** Nach dem Senden: dieses Gespräch wählen, sobald die neu geladene Liste da ist. */
  const [nachSenden, setNachSenden] = useState<{ gespraechId: string; dealId: string | null } | null>(null);
  const listeLauf = useRef(0);
  const mitteLauf = useRef(0);
  const hatListe = useRef(false);
  hatListe.current = liste.art === "fertig";
  const listeRef = useRef(liste);
  listeRef.current = liste;
  const chipsRef = useRef(chipsGesamt);
  chipsRef.current = chipsGesamt;
  /** Suchbegriff, zu dem die angezeigte Liste gehört; null ohne Liste. */
  const geladenQ = useRef<string | null>(null);

  const suchbegriff = sucheAktiv(filter.suche) ? filter.suche.trim() : "";
  const suchbegriffRef = useRef(suchbegriff);
  suchbegriffRef.current = suchbegriff;
  const gewaehltKey = eParam;
  const gewaehltRef = useRef(gewaehltKey);
  gewaehltRef.current = gewaehltKey;

  // ── Liste ──────────────────────────────────────────────────────────────────

  const listeLaden = useCallback(async (q: string, grund: Grund) => {
    const dieser = ++listeLauf.current;
    const url = q ? `/api/v1/inbox/liste?q=${encodeURIComponent(q)}` : "/api/v1/inbox/liste";
    const r = await apiAufruf<InboxListe>(url);
    if (dieser !== listeLauf.current) return;
    if (r.ok) {
      geladenQ.current = q;
      setListe({ art: "fertig", liste: r.data });
      // Bei Suche zählt der Server nur die Treffer; die Chips behalten den Gesamtstand.
      if (!q) setChipsGesamt(r.data.chips);
      return;
    }
    // Eine gescheiterte Suche (oder das Leeren der Suche) darf die alte Liste nicht als Treffer stehen lassen (Review I2).
    const folge = ladeFehlerFolge({ hatListe: hatListe.current, geladenQ: geladenQ.current, angefragtQ: q, grund });
    if (folge === "toast") toast.error("Liste konnte nicht neu geladen werden.", { description: r.message });
    if (folge === "fehler") {
      geladenQ.current = null;
      setListe({ art: "fehler", meldung: r.message });
    }
  }, []);

  // Beim Öffnen und bei jeder Änderung des Suchbegriffs (ab 2 Zeichen, verzögert).
  useEffect(() => {
    const t = window.setTimeout(() => void listeLaden(suchbegriff, "oeffnen"), suchbegriff ? SUCHE_VERZUG_MS : 0);
    return () => window.clearTimeout(t);
  }, [suchbegriff, listeLaden]);

  // ── Gespräch und Kurzfassung ───────────────────────────────────────────────

  const gespraechLaden = useCallback(async (s: Schluessel, grund: Grund): Promise<Gespraech | null> => {
    const dieser = ++mitteLauf.current;
    const [g, k] = await Promise.all([
      apiAufruf<Gespraech>(gespraechUrl(s)),
      s.art === "deal" ? apiAufruf<Kurzfassung>(`/api/v1/deals/${encodeURIComponent(s.id)}/kurzfassung`) : Promise.resolve(null),
    ]);
    if (dieser !== mitteLauf.current) return null;
    if (!g.ok) {
      if (grund === "oeffnen") setMitte({ art: "fehler", meldung: g.message, status: g.status });
      else if (grund === "aktion") toast.error("Gespräch konnte nicht neu geladen werden.", { description: g.message });
      return null;
    }
    if (k && !k.ok && grund !== "takt") toast.error("Deal-Kurzfassung konnte nicht geladen werden.", { description: k.message });
    setMitte((alt) => ({
      art: "fertig",
      gespraech: g.data,
      // Fällt die Kurzfassung beim stillen Neuladen aus, bleibt die alte stehen.
      kurz: k?.ok ? k.data : alt.art === "fertig" ? alt.kurz : null,
    }));
    return g.data;
  }, []);

  /** Das Öffnen markiert direkt verknüpfte Gespräche gelesen; die Liste spiegelt das sofort (Review I1). */
  const alsGelesen = useCallback((key: string) => {
    const z = listeRef.current;
    if (z.art !== "fertig") return;
    const neu = gelesenAnwenden(z.liste.eintraege, chipsRef.current, key);
    if (!neu) return;
    setListe({ art: "fertig", liste: { ...z.liste, eintraege: neu.eintraege } });
    setChipsGesamt(neu.chips);
  }, []);

  useEffect(() => {
    const s = schluesselAus(gewaehltKey);
    mitteLauf.current++;
    if (!s) {
      setMitte({ art: "leer" });
      return;
    }
    setMitte({ art: "laden" });
    void gespraechLaden(s, "oeffnen").then((g) => {
      if (g && gewaehltKey) alsGelesen(gewaehltKey);
    });
  }, [gewaehltKey, gespraechLaden, alsGelesen]);

  // Takt: Liste und offenes Gespräch, nur bei sichtbarem Tab; beim Zurückkehren sofort.
  useEffect(() => {
    const takt = () => {
      if (document.hidden) return;
      void listeLaden(suchbegriffRef.current, "takt");
      const s = schluesselAus(gewaehltRef.current);
      if (s) void gespraechLaden(s, "takt");
    };
    const id = window.setInterval(takt, TAKT_MS);
    document.addEventListener("visibilitychange", takt);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", takt);
    };
  }, [listeLaden, gespraechLaden]);

  /** Nach jeder Aktion: Gespräch (und Kurzfassung) und Liste neu; liefert das frische Gespräch. */
  const neuLaden = useCallback(async (): Promise<Gespraech | null> => {
    const s = schluesselAus(gewaehltRef.current);
    const [g] = await Promise.all([s ? gespraechLaden(s, "aktion") : Promise.resolve(null), listeLaden(suchbegriffRef.current, "aktion")]);
    return g;
  }, [gespraechLaden, listeLaden]);

  // ── Verfassen (Plan 10, Entscheidung 8) ────────────────────────────────────

  /** Öffnet das WhatsApp-Fenster; Konten wie in der alten Inbox: nur WhatsApp und aktiv. */
  const verfassenOeffnen = useCallback(async (vorgabe: VerfassenVorgabe, text?: string) => {
    setVerfassen({ art: "laden", vorgabe, text });
    const r = await apiAufruf<ChannelAccount[]>("/api/v1/inbox/channel-accounts");
    if (!r.ok) {
      setVerfassen({ art: "zu" });
      toast.error("WhatsApp-Konten konnten nicht geladen werden.", { description: r.message });
      return;
    }
    const konten = (r.data ?? []).filter((k) => k.channelType === "whatsapp" && k.isActive);
    setVerfassen((z) => (z.art === "laden" ? { art: "offen", vorgabe, konten, text } : z));
    // kv-danach: WhatsApp Business beginnt ein Gespräch nur mit Vorlage, freier Text geht dort nicht.
    const konto = konten.find((k) => k.id === vorgabe.channelAccountId) ?? konten[0];
    if (text && konto?.waPhoneNumberId) {
      toast.message("Erster Kontakt über WhatsApp Business geht nur mit Vorlage.", {
        description: "Den vorbereiteten Text kannst du kopieren und nach der Antwort des Kunden senden.",
        cancel: {
          label: "Text kopieren",
          onClick: () => void textKopieren(Promise.resolve(text)).then((ok) => (ok ? toast.success("Text kopiert.") : toast.error("Kopieren ging nicht."))),
        },
        duration: 20_000,
      });
    }
  }, []);

  // ── „Im Chat senden“ nach dem KV (kv-danach) ──────────────────────────────

  /** Deal, für den der Kurztext zum KV vorbereitet wird; `?kv=1` wird sofort abgeräumt. */
  const [kvDeal, setKvDeal] = useState<string | null>(null);
  useEffect(() => {
    if (params.get(KV_NACHRICHT_PARAM) !== "1") return;
    const s = schluesselAus(params.get("e"));
    const rest = new URLSearchParams(params.toString());
    rest.delete(KV_NACHRICHT_PARAM);
    const q = rest.toString();
    window.history.replaceState(null, "", q ? `/app/inbox?${q}` : "/app/inbox");
    if (s?.art === "deal") setKvDeal(s.id);
  }, [params]);
  // Wer zu einem anderen Eintrag wechselt, verwirft den Auftrag (sonst käme er beim Zurückkehren wieder).
  useEffect(() => {
    if (!kvDeal) return;
    const s = schluesselAus(eParam);
    if (s && !(s.art === "deal" && s.id === kvDeal)) setKvDeal(null);
  }, [eParam, kvDeal]);
  const kvAuftrag = useMemo<KvAuftrag>(
    () => ({ onErledigt: () => setKvDeal(null), onVerfassen: (vorgabe, text) => void verfassenOeffnen(vorgabe, text) }),
    [verfassenOeffnen]
  );

  // `?verfassen=1` (Akte, alte Links) öffnet das Fenster einmal; die Abfrage wird sofort
  // abgeräumt, damit ein Neuladen es nicht erneut öffnet.
  useEffect(() => {
    const vorgabe = verfassenAus(new URLSearchParams(params.toString()));
    if (!vorgabe) return;
    const rest = new URLSearchParams(params.toString());
    for (const k of VERFASSEN_PARAMS) rest.delete(k);
    const q = rest.toString();
    window.history.replaceState(null, "", q ? `/app/inbox?${q}` : "/app/inbox");
    void verfassenOeffnen(vorgabe);
  }, [params, verfassenOeffnen]);

  const nachGesendet = useCallback(
    (gespraechId: string) => {
      const dealId = verfassen.art === "offen" ? verfassen.vorgabe.dealRecordId : null;
      setVerfassen({ art: "zu" });
      setNachSenden({ gespraechId, dealId });
      void listeLaden(suchbegriffRef.current, "aktion");
    },
    [verfassen, listeLaden]
  );

  // ── Auswahl ────────────────────────────────────────────────────────────────

  const eintraege = liste.art === "fertig" ? liste.liste.eintraege : [];
  const gefiltert = useMemo(() => gruppieren(eintraege, filter), [eintraege, filter]);
  const eintrag = useMemo(() => eintraege.find((e) => e.key === gewaehltKey) ?? null, [eintraege, gewaehltKey]);
  const schluessel = useMemo(() => schluesselAus(gewaehltKey), [gewaehltKey]);

  const waehlen = useCallback((key: string | null, ersetzen: boolean) => {
    const url = inboxUrl(key);
    // Native History-Aufrufe halten useSearchParams aktuell, ohne die Seite neu vom Server zu holen.
    if (ersetzen) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  // Nach dem Senden den Eintrag des neuen Gesprächs wählen. Hängt es (über die Nummer)
  // an einem Deal, steht es unter dessen Schlüssel; sonst `nachVerfassenSchluessel`.
  useEffect(() => {
    if (!nachSenden || liste.art !== "fertig") return;
    const treffer = liste.liste.eintraege.find((e) => e.gespraechIds.includes(nachSenden.gespraechId));
    setNachSenden(null);
    waehlen(treffer?.key ?? nachVerfassenSchluessel(nachSenden.gespraechId, nachSenden.dealId), false);
  }, [nachSenden, liste, waehlen]);

  // Desktop ohne Auswahl: der erste sichtbare Eintrag (Entscheidung 14), still in die URL.
  useEffect(() => {
    if (!breit || eParam || liste.art !== "fertig") return;
    const erster = gefiltert.haupt[0]?.key;
    if (erster) waehlen(erster, true);
  }, [breit, eParam, liste.art, gefiltert, waehlen]);

  const aktionen = useLaneAktionen({
    eintrag,
    gespraech: mitte.art === "fertig" ? mitte.gespraech : null,
    schluessel,
    kurz: mitte.art === "fertig" ? mitte.kurz : null,
    onNeuLaden: neuLaden,
  });

  const filterSetzen = useCallback((teil: Partial<InboxFilter>) => setFilter((f) => ({ ...f, ...teil })), []);

  const chipsAnzeige = chipsGesamt ?? (liste.art === "fertig" && !suchbegriff ? liste.liste.chips : null);

  const fenster =
    verfassen.art === "offen" ? (
      <div className="neu-alt-hell">
        <ComposeWhatsAppModal
          accounts={verfassen.konten}
          initialChannelAccountId={verfassen.vorgabe.channelAccountId ?? undefined}
          initialPhone={verfassen.vorgabe.telefon ?? undefined}
          initialCustomerName={verfassen.vorgabe.name ?? undefined}
          initialMessage={verfassen.text}
          dealRecordId={verfassen.vorgabe.dealRecordId}
          onClose={() => setVerfassen({ art: "zu" })}
          onSent={nachGesendet}
        />
      </div>
    ) : null;
  const verfassenLaedt = verfassen.art === "laden";

  if (breit === null) return <InboxSkelett />;

  const listePanel = (
    <InboxListePanel
      zustand={liste.art === "fertig" ? { art: "fertig" } : liste}
      haupt={gefiltert.haupt}
      info={gefiltert.info}
      anzahl={eintraege.length}
      abgeschnitten={liste.art === "fertig" && liste.liste.abgeschnitten}
      gesucht={suchbegriff !== ""}
      gewaehltKey={gewaehltKey}
      infoOffen={infoOffen || filter.chip === "info"}
      kompakt={!breit}
      onInfoOffen={setInfoOffen}
      // Desktop ersetzt den Eintrag in der URL; am Handy ist das Gespräch ein eigener Schritt (Zurück führt zur Liste).
      onWaehlen={(key) => waehlen(key, breit)}
      onErneut={() => void listeLaden(suchbegriff, "oeffnen")}
    />
  );

  // Handy (Entscheidung 15): mit Auswahl das Gespräch im Vollbild, sonst Kopf, Chips und Liste.
  if (!breit) {
    if (schluessel) {
      return (
        <div className="inbox inbox-vollbild">
          {fenster}
          <Mitte
            zustand={mitte}
            schluessel={schluessel}
            eintrag={eintrag}
            kompakt
            aktionen={aktionen}
            kv={kvDeal ? kvAuftrag : undefined}
            kvDeal={kvDeal}
            onNeuLaden={neuLaden}
            onErneut={() => void gespraechLaden(schluessel, "oeffnen")}
          />
        </div>
      );
    }
    return (
      <div className="inbox inbox-handy">
        <header className="inbox-handy-seite-kopf">
          <div>
            <h1>Inbox</h1>
            <p>{chipsAnzeige ? handyUnterzeile(chipsAnzeige) : "Wird geladen"}</p>
          </div>
          <GlassButton size="sm" aria-label="Neue Nachricht" disabled={verfassenLaedt} onClick={() => void verfassenOeffnen(LEERE_VORGABE)}>
            +
          </GlassButton>
        </header>
        {fenster}
        <InboxChipsZeile chips={chipsAnzeige} aktiv={filter.chip} kompakt onWaehlen={(chip) => filterSetzen({ chip })} />
        {listePanel}
      </div>
    );
  }

  return (
    <div className="inbox">
      <header className="neu-kopf inbox-kopf">
        <div className="inbox-kopf-text">
          <h1>Inbox</h1>
          <p className="neu-kopf-zweite">Alles, was eine Antwort braucht, in einer Liste.</p>
          <p className="inbox-meta">Sortiert: zuerst, was auf uns wartet, dann nach Zeit. WhatsApp, E-Mail und Anrufe zusammen.</p>
        </div>
        <div className="inbox-kopf-aktionen">
          <GlassButton disabled={verfassenLaedt} onClick={() => void verfassenOeffnen(LEERE_VORGABE)}>
            + Neue Nachricht
          </GlassButton>
        </div>
      </header>
      {fenster}

      <InboxChipsZeile chips={chipsAnzeige} aktiv={filter.chip} kompakt={false} onWaehlen={(chip) => filterSetzen({ chip })} />
      <InboxLeiste
        filter={filter}
        firmen={liste.art === "fertig" ? liste.liste.firmen : []}
        stufen={liste.art === "fertig" ? liste.liste.stufen : []}
        onFilter={filterSetzen}
      />

      <div className="inbox-koerper">
        {listePanel}
        <section className="akte-gespraech inbox-mitte" data-slot="gespraech" aria-label="Gespräch">
          <Mitte
            zustand={mitte}
            schluessel={schluessel}
            eintrag={eintrag}
            kv={kvDeal ? kvAuftrag : undefined}
            kvDeal={kvDeal}
            onNeuLaden={neuLaden}
            onErneut={() => schluessel && void gespraechLaden(schluessel, "oeffnen")}
          />
        </section>
        <aside className="inbox-rechts" aria-label="Deal-Kurzfassung">
          {mitte.art === "fertig" && schluessel ? (
            mitte.kurz ? (
              <KurzfassungSpalte
                kurz={mitte.kurz}
                inInfo={eintrag?.gruppe === "info"}
                aktionen={aktionen}
                onNachfass={(nachfass) => setMitte((m) => (m.art === "fertig" && m.kurz ? { ...m, kurz: { ...m.kurz, nachfass } } : m))}
                onNeuLaden={neuLaden}
              />
            ) : schluessel.art === "gespraech" ? (
              <KontaktKarte gespraechId={schluessel.id} eintrag={eintrag} gespraech={mitte.gespraech} aktionen={aktionen} />
            ) : null
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Die Mitte je Zustand: leer, Skelett, Fehler oder das Gespräch-Panel (neu je Eintrag). */
function Mitte({
  zustand,
  schluessel,
  eintrag,
  kompakt = false,
  aktionen,
  kv,
  kvDeal = null,
  onNeuLaden,
  onErneut,
}: {
  zustand: MitteZustand;
  schluessel: Schluessel | null;
  eintrag: ReturnType<typeof gruppieren>["haupt"][number] | null;
  kompakt?: boolean;
  aktionen?: ReturnType<typeof useLaneAktionen>;
  /** kv-danach: Auftrag für den Deal `kvDeal`; nur die Mitte genau dieses Deals bekommt ihn. */
  kv?: KvAuftrag;
  kvDeal?: string | null;
  onNeuLaden: () => Promise<Gespraech | null>;
  onErneut: () => void;
}) {
  // Am Handy braucht auch der Lade- und Fehlerzustand den Weg zurück zur Liste.
  const zurueck = kompakt ? (
    <Link href="/app/inbox" className="inbox-zurueck">
      ‹ Inbox
    </Link>
  ) : null;

  if (zustand.art === "leer" || !schluessel) {
    return (
      <>
        {zurueck}
        <div className="akte-panel inbox-mitte-leer">
          <p>Kein Gespräch gewählt.</p>
        </div>
      </>
    );
  }
  if (zustand.art === "laden") {
    return (
      <>
        {zurueck}
        <div className="akte-panel inbox-mitte-leer" aria-busy="true" aria-label="Gespräch wird geladen">
          <span className="lg-skeleton" data-variant="line" style={{ width: "40%" }} />
          <span className="lg-skeleton" style={{ height: 120 }} />
          <span className="lg-skeleton" data-variant="line" style={{ width: "70%" }} />
        </div>
      </>
    );
  }
  if (zustand.art === "fehler") {
    return (
      <>
        {zurueck}
        <div className="akte-panel inbox-mitte-leer" role="alert">
          <p>{zustand.status === 404 ? "Dieses Gespräch gibt es nicht mehr." : `Gespräch konnte nicht geladen werden. ${zustand.meldung}`}</p>
          {zustand.status !== 404 ? (
            <GlassButton size="sm" onClick={onErneut}>
              Erneut laden
            </GlassButton>
          ) : null}
        </div>
      </>
    );
  }
  return (
    <InboxMitte
      key={`${schluessel.art}:${schluessel.id}`}
      schluessel={schluessel}
      eintrag={eintrag}
      gespraech={zustand.gespraech}
      kurz={zustand.kurz}
      kompakt={kompakt}
      aktionen={aktionen}
      kv={kv && schluessel.art === "deal" && schluessel.id === kvDeal ? kv : undefined}
      onNeuLaden={onNeuLaden}
    />
  );
}

function InboxSkelett() {
  return (
    <div className="inbox" aria-busy="true" aria-label="Inbox wird geladen">
      <header className="neu-kopf inbox-kopf">
        <div className="inbox-kopf-text">
          <h1>Inbox</h1>
          <p className="neu-kopf-zweite">Alles, was eine Antwort braucht, in einer Liste.</p>
        </div>
      </header>
      <div className="inbox-koerper">
        <span className="lg-skeleton inbox-skelett-panel" />
        <span className="lg-skeleton inbox-skelett-panel" />
        <span className="lg-skeleton inbox-skelett-panel" />
      </div>
    </div>
  );
}
