"use client";
/**
 * Lagekarte, Panel-Tab „Angebot“: Wertblock, Angebotsschritte als kleine
 * Zeitleiste, KV-PDF-Knopf und „Kundenlink kopieren“. Das PDF öffnet das
 * Panel (DocumentPreviewModal), hier wird nur ausgelöst. Nur lesend.
 */
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { AlertTriangle, Check, Copy, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { plausiblerCent, type KvDokumentStand, type LeadPunkt, type WertArt } from "@/lib/lagekarte/typen";
import { euroAusCent } from "@/lib/lagekarte/farben";
import { useVorschau, VORSCHAU_TITEL } from "../vorschau";

const WERT_ART_LABEL: Record<WertArt, string> = {
  bestaetigt: "angenommen",
  angebot: "laut Angebot",
  schaetzung: "geschätzt",
};

const STAND_LABEL: Record<KvDokumentStand, string> = {
  angenommen: "angenommene Fassung",
  aktuell: "aktuell",
  veraltet: "kein aktuelles PDF",
  keins: "kein PDF",
};

const KNOPF =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--lk-panel-rand)] bg-[var(--lk-panel)] px-3 text-[13px] font-medium text-[var(--lk-text)] transition-colors hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--lk-panel)] max-lg:min-h-11";

function datum(iso: string): string {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "d. MMM yyyy", { locale: de });
}

interface Schritt {
  key: string;
  erledigt: boolean;
  text: string;
  hinweis?: string;
}

function schritteAus(kv: LeadPunkt["kv"]): Schritt[] {
  const gesehen = kv.linkAngesehenAnzahl > 0;
  return [
    {
      key: "erstellt",
      erledigt: kv.angebotErstellt,
      text: kv.angebotErstellt
        ? `Angebot erstellt${kv.angebotErstelltAm ? ` ${datum(kv.angebotErstelltAm)}` : ""}`
        : "Noch kein Angebot",
    },
    {
      key: "link",
      erledigt: kv.linkAktiv,
      text: `Kundenlink ${kv.linkAktiv ? "aktiv" : kv.linkErstelltAm ? "widerrufen" : "keiner"}`,
      hinweis: kv.linkErstelltAm ? `erstellt ${datum(kv.linkErstelltAm)}` : undefined,
    },
    {
      key: "gesehen",
      erledigt: gesehen,
      text: gesehen
        ? `Vom Kunden angesehen ${kv.linkAngesehenAnzahl}×${
            kv.linkZuletztAngesehen ? ` · zuletzt ${datum(kv.linkZuletztAngesehen)}` : ""
          }`
        : "Noch nicht angesehen",
    },
    {
      key: "angenommen",
      erledigt: Boolean(kv.angenommenAm),
      text: kv.angenommenAm ? `Angenommen ${datum(kv.angenommenAm)}` : "Noch nicht angenommen",
    },
  ];
}

interface KvKarteProps {
  lead: LeadPunkt;
  /** Öffnet das KV-PDF im DocumentPreviewModal (Zustand liegt im Panel). */
  onKvAnsehen: () => void;
}

interface Kundenlink {
  url: string;
  revokedAt: string | null;
}

/** Ladefehler mit fertiger Nutzermeldung; `keinLink` = 404 oder leere URL. */
class KundenlinkFehler extends Error {
  constructor(
    message: string,
    readonly keinLink: boolean
  ) {
    super(message);
  }
}

/** GET /api/v1/customer-link/{id}: 404 oder leere URL → KundenlinkFehler(keinLink). */
async function ladeKundenlink(leadId: string): Promise<Kundenlink> {
  const res = await fetch(`/api/v1/customer-link/${encodeURIComponent(leadId)}`);
  if (res.status === 404) throw new KundenlinkFehler("Kein Kundenlink vorhanden", true);
  if (!res.ok) throw new KundenlinkFehler(`Kundenlink konnte nicht geladen werden (${res.status})`, false);
  const body = (await res.json()) as { data?: { url?: string | null; revokedAt?: string | null } };
  const url = body.data?.url;
  if (!url) throw new KundenlinkFehler("Kein Kundenlink vorhanden", true);
  return { url, revokedAt: body.data?.revokedAt ?? null };
}

/**
 * Schreibt die noch ladende URL in die Zwischenablage. Der Aufruf von
 * `navigator.clipboard.write` muss synchron im Klick passieren, sonst ist die
 * Nutzeraktivierung nach dem `await fetch` weg und WebKit (Safari, iOS) lehnt
 * mit NotAllowedError ab. Mit `ClipboardItem` darf der Inhalt ein Promise sein;
 * wo es `ClipboardItem` nicht gibt, bleibt `writeText` nach dem Laden.
 */
function inZwischenablage(urlVersprechen: Promise<string>): Promise<void> {
  const zwischenablage = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!zwischenablage) return Promise.reject(new Error("Zwischenablage nicht verfügbar"));
  if (typeof ClipboardItem !== "undefined" && typeof zwischenablage.write === "function") {
    const blob = urlVersprechen.then((url) => new Blob([url], { type: "text/plain" }));
    return zwischenablage.write([new ClipboardItem({ "text/plain": blob })]);
  }
  return urlVersprechen.then((url) => zwischenablage.writeText(url));
}

const LINK_WIDERRUFEN = "Link ist widerrufen, im Lead neu aktivieren";

export default function KvKarte({ lead, onKvAnsehen }: KvKarteProps) {
  const vorschau = useVorschau();
  const { kv, wert, bezahltCent } = lead;
  const [linkLaedt, setLinkLaedt] = useState(false);
  const schritte = schritteAus(kv);
  // Ruling 7: unplausibel hoher Wert (Tippfehler) wird gedämpft gezeigt und zur Prüfung markiert.
  const unplausibel = wert !== null && plausiblerCent(wert) === null;

  function linkKopieren() {
    if (linkLaedt) return;
    // M-9: Ein widerrufener Link wird nie kopiert (er könnte sonst beim Kunden landen). Laut
    // Kartendaten widerrufen (Link angelegt, aber nicht aktiv): gar nicht erst laden.
    if (!kv.linkAktiv && kv.linkErstelltAm) {
      toast.warning(LINK_WIDERRUFEN);
      return;
    }
    setLinkLaedt(true);

    let geladen: Kundenlink | null = null;
    let ladeFehler: unknown = null;
    const linkVersprechen = ladeKundenlink(lead.id).then(
      (link) => {
        geladen = link;
        return link;
      },
      (fehler: unknown) => {
        ladeFehler = fehler;
        throw fehler;
      }
    );
    // Zusätzlicher Handler, damit ein Ladefehler nie als unbehandelte Ablehnung auftaucht;
    // der Fehler wird unten über das Ergebnis des Clipboard-Schreibens ausgewertet.
    linkVersprechen.catch(() => undefined);

    // Synchron im Klick starten (siehe inZwischenablage). Ist der Link inzwischen widerrufen,
    // lehnt das URL-Versprechen ab und die Zwischenablage bleibt unverändert.
    inZwischenablage(
      linkVersprechen.then((link) => {
        if (link.revokedAt) throw new Error("Kundenlink widerrufen");
        return link.url;
      }),
    )
      .then(() => {
        if (!geladen) throw new Error("Kundenlink ohne Ergebnis");
        toast.success("Kundenlink kopiert");
      })
      .catch(() => {
        if (geladen?.revokedAt) {
          toast.warning(LINK_WIDERRUFEN);
        } else if (ladeFehler instanceof KundenlinkFehler) {
          if (ladeFehler.keinLink) toast(ladeFehler.message);
          else toast.error(ladeFehler.message);
        } else if (ladeFehler) {
          toast.error("Kundenlink konnte nicht geladen werden (keine Verbindung)");
        } else {
          toast.error("Kundenlink konnte nicht kopiert werden");
        }
      })
      .finally(() => setLinkLaedt(false));
  }

  return (
    <div className="space-y-5 px-4 py-4">
      {/* Wertblock */}
      <div
        className="rounded-xl border border-[var(--lk-panel-rand)] px-4 py-3"
        style={{ background: "var(--lk-panel-2)" }}
      >
        <div className="k-label" style={{ color: "var(--lk-text-schwach)" }}>
          Wert
        </div>
        {wert ? (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={`k-display leading-none ${unplausibel ? "text-[24px] text-[var(--lk-text-schwach)]" : "text-[32px] text-[var(--lk-text)]"}`}
              >
                {euroAusCent(wert.cent)}
              </span>
              <span className="text-[12.5px] text-[var(--lk-text-leise)]">{WERT_ART_LABEL[wert.art]}</span>
            </div>
            {unplausibel && (
              <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug" style={{ color: "var(--lk-warn)" }}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Wert ungewöhnlich hoch, bitte prüfen</span>
              </p>
            )}
          </>
        ) : (
          <div className="k-display mt-1 text-[24px] leading-none text-[var(--lk-text-schwach)]">unbekannt</div>
        )}
        {bezahltCent > 0 && (
          <div className="mt-2 text-[12.5px]" style={{ color: "var(--lk-ok)" }}>
            davon bezahlt {euroAusCent(bezahltCent)}
          </div>
        )}
      </div>

      {/* Schritte */}
      <ol className="space-y-0" aria-label="Angebotsschritte">
        {schritte.map((s, i) => {
          const letzter = i === schritte.length - 1;
          return (
            <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
              {!letzter && (
                <span
                  aria-hidden="true"
                  className="absolute left-[7px] top-4 bottom-0 w-px"
                  style={{ background: s.erledigt ? "var(--lk-ok)" : "var(--lk-panel-rand)" }}
                />
              )}
              <span
                aria-hidden="true"
                className="relative z-[1] mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
                style={
                  s.erledigt
                    ? { background: "var(--lk-ok)", borderColor: "var(--lk-ok)", color: "#fff" }
                    : { background: "var(--lk-panel)", borderColor: "var(--lk-panel-rand)" }
                }
              >
                {s.erledigt && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <div className="min-w-0">
                <div
                  className="text-[13px] leading-snug"
                  style={{ color: s.erledigt ? "var(--lk-text)" : "var(--lk-text-schwach)" }}
                >
                  {s.text}
                  {s.erledigt && <span className="sr-only"> (erledigt)</span>}
                </div>
                {s.hinweis && <div className="text-[11.5px] text-[var(--lk-text-schwach)]">{s.hinweis}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Aktionen */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={KNOPF}
          onClick={onKvAnsehen}
          disabled={!kv.dokumentId || vorschau}
          title={
            vorschau
              ? VORSCHAU_TITEL
              : kv.dokumentId
                ? `KV-PDF ansehen (${STAND_LABEL[kv.dokumentStand]})`
                : STAND_LABEL[kv.dokumentStand]
          }
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          <span>KV-PDF</span>
          <span className="text-[11.5px] font-normal text-[var(--lk-text-schwach)]">{STAND_LABEL[kv.dokumentStand]}</span>
        </button>
        <button
          type="button"
          className={KNOPF}
          onClick={linkKopieren}
          disabled={linkLaedt || vorschau}
          aria-busy={linkLaedt}
          title={vorschau ? VORSCHAU_TITEL : undefined}
        >
          {linkLaedt ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          Kundenlink kopieren
        </button>
      </div>
    </div>
  );
}
