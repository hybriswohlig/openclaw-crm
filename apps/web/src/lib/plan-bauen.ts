/**
 * Plan und Heute (Plan 8, Task A): reine Bausteine zwischen Kalender-Ereignis,
 * Leads-Eintrag und Antwort. Eintrag bauen (Ton, Titel, Zeile, Zeittext,
 * ziehbar), sortieren, filtern, Startseite „Heute“ und Zähler der
 * Seitenleiste. Ohne Datenbankzugriff; geladen wird in `services/plan.ts`
 * und `services/heute.ts`.
 *
 * Regeln aus dem Vertrag (`lib/plan-heute.ts`) und aus dem Board
 * (`lib/leads-board-bauen.ts`), unverändert übernommen: Ton über `tonAus`,
 * ziehbar über `ziehbarAus`, Chips über `chipsZaehlen`, Wörter für den
 * Zeittext aus `lib/ablauf.ts`.
 */
import { BEGINN_WORT, type AblaufFakten } from "@/lib/ablauf";
import { ortAus } from "@/lib/akte";
import { berlinDateString } from "@/lib/berlin-date";
import type { InboxListe } from "@/lib/inbox-neu";
import { firmenPunktFarbe } from "@/lib/leads-board";
import { chipsZaehlen, type LeadEintrag } from "@/lib/leads-board-bauen";
import {
  HEUTE_LISTE_MAX,
  OFFENE_LEAD_KATEGORIEN,
  eintraegeAm,
  eintragTitel,
  eintragZeile,
  streckeText,
  tagPlus,
  tonAus,
  ziehbarAus,
  type HeuteAntwort,
  type HeuteFreigabe,
  type HeuteMeldung,
  type HeuteTermin,
  type NavZaehler,
  type PlanArt,
  type PlanDatumQuelle,
  type PlanEintrag,
  type PlanLive,
} from "@/lib/plan-heute";
import type { CalendarEvent } from "@/services/calendar/map-events";

// ─── Eintrag ─────────────────────────────────────────────────────────────────

/**
 * Datumsquelle des Vertrags aus `CalendarEvent.dateSource`. Ein Ereignis ohne
 * Angabe (nicht über den Plan-Loader gebaut) zählt als „fenster“: dann ist es
 * nicht ziehbar, im Zweifel also sicher.
 */
export function datumQuelleAus(ev: Pick<CalendarEvent, "kind" | "dateSource">): PlanDatumQuelle {
  if (ev.kind === "appointment") return "termin";
  switch (ev.dateSource) {
    case "attribute":
      return "feld";
    case "selection":
      return "auswahl";
    case "proposal":
      return "angebot";
    case "appointment":
      return "termin";
    default:
      return "fenster";
  }
}

/** Leistung zur Art der Leads-Karte („Umzug“, „Entrümpelung und Umzug“, „Küchenmontage“). */
function leistungAusArt(art: string | null): AblaufFakten["leistung"] {
  const a = (art ?? "").trim();
  if (a.startsWith("Küchenmontage")) return "kitchen_installation";
  if (a.startsWith("Entrümpelung und Umzug")) return "clearance_move";
  if (a.startsWith("Entrümpelung")) return "clearance";
  return "move";
}

/** „Beladen“ bei Umzügen, „Beginn“ bei Entrümpelung und Montage (`BEGINN_WORT`). */
export function beginnWortAus(art: string | null): string {
  return BEGINN_WORT[leistungAusArt(art)];
}

/**
 * „07:30 Beladen · ca. 13:00 fertig“; „fertig“ nur mit echtem Ende (nicht bei
 * der +2 h-Notlösung). Besichtigung nur die Uhrzeit („16:00“). Ohne Uhrzeit null.
 */
export function zeitTextAus(
  ev: Pick<CalendarEvent, "startTime" | "endTime" | "endIsFallback" | "allDay">,
  art: PlanArt,
  beginnWort: string,
): string | null {
  if (ev.allDay || !ev.startTime) return null;
  if (art === "besichtigung") return ev.startTime;
  const ende = ev.endTime && ev.endIsFallback !== true ? `ca. ${ev.endTime} fertig` : null;
  return [`${ev.startTime} ${beginnWort}`, ende].filter(Boolean).join(" · ");
}

/**
 * Plan-Eintrag aus Kalender-Ereignis und Leads-Eintrag des Deals. Ohne Lead:
 * Name aus `ev.title`, Kategorie null (also gestrichelt), Orte aus den
 * Kalender-Adressen, Firma aus dem Kalender.
 */
export function eintragAus(
  ev: CalendarEvent,
  lead: LeadEintrag | null,
  extra: { transporter: string | null },
  heute: string,
): PlanEintrag {
  const karte = lead?.karte ?? null;
  const art: PlanArt = ev.kind === "appointment" ? "besichtigung" : "umzug";
  const label = art === "besichtigung" ? ev.appointmentLabel || "Besichtigung" : karte?.art || "Umzug";
  const datumQuelle = datumQuelleAus(ev);
  const kategorie = karte?.stufe.kategorie ?? null;
  const teamFehlt = karte?.teamFehlt ?? false;
  const { ton, fehlt } = tonAus({ art, kategorie, geschaetzt: ev.estimated, teamFehlt, bisTag: ev.endDate }, heute);
  const name = karte?.name ?? (ev.title.trim() || "Ohne Namen");
  const betragText = karte?.betrag ? karte.betragText : null;
  const strecke = karte
    ? streckeText(karte.von, karte.nach)
    : streckeText(ortAus(ev.fromAddress), ortAus(ev.toAddress));
  const stufe = karte?.stufe ?? { id: ev.stageId, label: ev.stageTitle ?? "Ohne Stufe", kategorie: null };
  const firma =
    karte?.firma ??
    (karte === null && ev.companyId
      ? { id: ev.companyId, name: ev.companyName ?? "Ohne Namen", farbe: firmenPunktFarbe(ev.companyName) }
      : null);

  const basis = { art, ton, datumQuelle, tag: ev.date, bisTag: ev.endDate };
  return {
    id: ev.id,
    dealId: ev.dealId,
    art,
    label,
    tag: ev.date,
    bisTag: ev.endDate,
    von: ev.startTime,
    bis: ev.endTime,
    zeitText: zeitTextAus(ev, art, beginnWortAus(karte?.art ?? null)),
    ton,
    fehlt,
    titel: eintragTitel(name, art, label, ton),
    zeile: eintragZeile({
      art,
      label,
      ton,
      fehlt,
      stufeLabel: stufe.label,
      betragText,
      strecke,
      tag: ev.date,
      von: ev.startTime,
    }),
    betragText,
    strecke,
    team: karte?.team ?? [],
    teamFehlt,
    transporter: art === "umzug" ? extra.transporter : null,
    firma,
    stufe,
    datumQuelle,
    ziehbar: ziehbarAus(basis, heute),
    annahmeAm: karte?.fakten.annahmeAm ?? null,
    href: `/app/leads/${ev.dealId}`,
  };
}

/** Tag, dann Uhrzeit (ganztägig zuletzt), dann Titel, zuletzt ID (stabil). */
export function planSortieren(e: PlanEintrag[]): PlanEintrag[] {
  return [...e].sort(
    (a, b) =>
      a.tag.localeCompare(b.tag) ||
      (a.von ?? "99:99").localeCompare(b.von ?? "99:99") ||
      a.titel.localeCompare(b.titel, "de") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Firma (Einträge ohne Firma fallen bei gesetztem Filter heraus, wie im alten
 * Kalender) und Deal-Menge (Leads-Filter, Mitarbeiter); null = kein Filter.
 */
export function planFiltern(
  e: PlanEintrag[],
  f: { firmaId: string | null; dealIds: ReadonlySet<string> | null },
): PlanEintrag[] {
  return e.filter((x) => {
    if (f.firmaId && x.firma?.id !== f.firmaId) return false;
    if (f.dealIds && !f.dealIds.has(x.dealId)) return false;
    return true;
  });
}

// ─── Heute ───────────────────────────────────────────────────────────────────

/** Live-Zeiten nur, wenn sie am Tag liegen (eine alte Abfahrt von einem früheren Termin zählt nicht). */
export function liveAmTag(l: PlanLive | null | undefined, tag: string): PlanLive | null {
  if (!l) return null;
  const amTag = (iso: string | null) => (iso && berlinDateString(new Date(iso)) === tag ? iso : null);
  const r: PlanLive = { losAm: amTag(l.losAm), vorOrtAm: amTag(l.vorOrtAm), fertigAm: amTag(l.fertigAm) };
  return r.losAm || r.vorOrtAm || r.fertigAm ? r : null;
}

function zeitWert(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Startseite „Heute“ (Entscheidung 11) aus dem Plan (heute bis heute+14,
 * sortiert), allen Leads-Einträgen (ungefiltert), der Inbox-Liste und den
 * Live-Zeiten je Deal.
 */
export function heuteAus(
  q: { plan: PlanEintrag[]; leads: LeadEintrag[]; inbox: InboxListe; live: Map<string, PlanLive> },
  jetzt: Date,
): HeuteAntwort {
  const tag = berlinDateString(jetzt);
  const morgenTag = tagPlus(tag, 1);
  const plan = planSortieren(q.plan);

  const heute: HeuteTermin[] = eintraegeAm(plan, tag).map((e) => ({
    ...e,
    live: e.art === "umzug" ? liveAmTag(q.live.get(e.dealId), tag) : null,
  }));
  const morgen = eintraegeAm(plan, morgenTag);
  const naechster = heute.length === 0 && morgen.length === 0 ? plan.find((e) => e.tag > morgenTag) ?? null : null;

  const alleMeldungen: HeuteMeldung[] = q.leads
    .filter((l) => l.karte.zahlungGemeldet !== null)
    .sort(
      (a, b) =>
        zeitWert(b.karte.aktivitaet) - zeitWert(a.karte.aktivitaet) || a.karte.name.localeCompare(b.karte.name, "de"),
    )
    .map((l) => ({
      dealId: l.karte.id,
      name: l.karte.name,
      text: l.karte.zahlungGemeldet as string,
      href: `/app/leads/${l.karte.id}`,
    }));

  // Gesamtzahl der Freigaben = `inbox.chips.kiEntwuerfe` (gleiche Definition: Eintrag mit `kiEntwurf`).
  const freigaben: HeuteFreigabe[] = q.inbox.eintraege
    .filter((e) => e.kiEntwurf !== null)
    .slice(0, HEUTE_LISTE_MAX)
    .map((e) => ({
      key: e.key,
      name: e.name,
      text: e.kiEntwurf?.text ?? "KI-Entwurf",
      href: `/app/inbox?${new URLSearchParams({ e: e.key }).toString()}`,
    }));

  return {
    tag,
    chips: chipsZaehlen(q.leads),
    inbox: q.inbox.chips,
    inboxAbgeschnitten: q.inbox.abgeschnitten,
    heute,
    morgen,
    naechster,
    meldungen: alleMeldungen.slice(0, HEUTE_LISTE_MAX),
    meldungenGesamt: alleMeldungen.length,
    freigaben,
    stand: jetzt.toISOString(),
  };
}

/** Seitenleiste (Entscheidung 12): „Heute“ = Chip „warten auf uns“, „Leads“ = offene Leads. */
export function navZaehlerAus(leads: LeadEintrag[]): NavZaehler {
  let offen = 0;
  for (const l of leads) {
    const k = l.karte.stufe.kategorie;
    if (k && OFFENE_LEAD_KATEGORIEN.has(k)) offen++;
  }
  return { heute: chipsZaehlen(leads).warten, leads: offen };
}
