"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Calculator, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KostenPosten } from "@/services/rechner/client";
import { prozentText, punkteText, reglerTexte, reglerZustand } from "./regler";
import { euroText, kartenAnzeige, type KalkulationJson, type KalkulationsStatus } from "./anzeige";

interface Antwort {
  status: KalkulationsStatus;
  kalkulation: KalkulationJson | null;
}

function PostenListe({ titel, posten, summe }: { titel: string; posten: KostenPosten[]; summe: number | undefined }) {
  if (posten.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{titel}</div>
      <table className="w-full text-xs">
        <tbody>
          {posten.map((p, i) => (
            <tr key={i} className="border-t border-border/60">
              <td className="py-1 pr-2">{p.bezeichnung}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                {p.menge !== null ? `${p.menge.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${p.einheit ?? ""}` : ""}
              </td>
              <td className="py-1 text-right tabular-nums">{p.betrag.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
            </tr>
          ))}
          {summe !== undefined && (
            <tr className="border-t border-border font-medium">
              <td className="py-1" colSpan={2}>Summe</td>
              <td className="py-1 text-right tabular-nums">{summe.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Kalkulation des Angebotsrechners für einen Lead: Spanne oder Festpreisvorschlag,
 * Mietstation, Kostenaufstellung und Annahmen; "Neu kalkulieren" und
 * "In Angebot übernehmen" (schreibt Festpreis und Annahmen ins Angebot).
 */
export function KalkulationKarte({ recordId, onUebernommen }: { recordId: string; onUebernommen?: () => void }) {
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [arbeitet, setArbeitet] = useState<"neu" | "uebernehmen" | null>(null);
  const [details, setDetails] = useState(false);
  // Reglerwert gehört zu genau einer Berechnung (computedAt): eine neue Rechnung setzt ihn ohne Effekt auf den Vorschlag zurück.
  const [reglerWahl, setReglerWahl] = useState<{ fuer: string | null; wert: number | null }>({ fuer: null, wert: null });

  const laden = useCallback(async (neu: boolean) => {
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/calculation`, { method: neu ? "POST" : "GET" });
      const body = res.ok ? await res.json() : null;
      if (body?.data) {
        setAntwort(body.data);
        return;
      }
    } catch {
      // Netzwerkfehler: unten wie ein Serverfehler behandelt.
    }
    // Letzten Stand behalten, nur den Status auf Fehler setzen.
    setAntwort((vorher) => ({ status: "fehler", kalkulation: vorher?.kalkulation ?? null }));
    if (neu) toast.error("Kalkulation konnte nicht geladen werden");
  }, [recordId]);

  useEffect(() => {
    laden(false).finally(() => setLaedt(false));
  }, [laden]);

  async function neuKalkulieren() {
    setArbeitet("neu");
    try {
      await laden(true);
    } finally {
      setArbeitet(null);
    }
  }

  async function uebernehmen(spanne: boolean, obergrenze: string, margeProzent: number | null) {
    if (spanne && !window.confirm(`Nur eine Spanne vorhanden. Obergrenze ${obergrenze} als Festpreis ins Angebot übernehmen?`)) return;
    setArbeitet("uebernehmen");
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/calculation/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bestaetigtSpanne: spanne, ...(margeProzent !== null ? { margeProzent } : {}) }),
      });
      if (res.ok) {
        toast.success("Festpreis und Annahmen ins Angebot übernommen");
        onUebernommen?.();
      } else {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? body?.error ?? "Übernahme fehlgeschlagen");
      }
      // Die Übernahme rechnet bei Bedarf neu: angezeigten Stand auffrischen.
      await laden(false);
    } catch {
      toast.error("Übernahme fehlgeschlagen (keine Verbindung)");
    } finally {
      setArbeitet(null);
    }
  }

  if (laedt) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Kalkulation wird geladen …
      </div>
    );
  }

  const k = antwort?.kalkulation ?? null;
  const a = kartenAnzeige(antwort?.status ?? "fehler", k);
  const e = k?.result ?? null;
  const marge = reglerWahl.fuer === (k?.computedAt ?? null) ? reglerWahl.wert : null;
  const setMarge = (wert: number | null) => setReglerWahl({ fuer: k?.computedAt ?? null, wert });
  const z = reglerZustand(e, marge);
  // Bei verfügbarem Regler steht der Reglerpreis groß oben: genau der Preis, den "In Angebot übernehmen" speichert.
  const t = reglerTexte(z);
  // Bei verfügbarem Regler ist der Reglerpreis der Festpreis, auch bei einer Spanne (Obergrenze mit gewählter Marge).
  const obergrenze = z.verfuegbar ? z.festpreis : e?.schaetzung?.festpreisBis;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Calculator className="h-3.5 w-3.5" />
            Kalkulation {a.spanne ? "(Schnellschätzung)" : a.art === "festpreis" ? "(Festpreisvorschlag)" : ""}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{t ? t.preis : a.preisText}</div>
          {a.station && <div className="mt-0.5 text-xs text-muted-foreground">{a.station}</div>}
          {!z.verfuegbar && e?.kosten && e.preis?.festpreis != null && !a.spanne && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Selbstkosten {euroText(e.kosten.selbstkosten)}
              {e.preis.margeProzent != null && `, Marge ${e.preis.margeProzent.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`}
            </div>
          )}
          {t && e?.preis && (
            <div className="mt-3 space-y-2">
              {e.preis.selbstkosten != null && (
                <div className="text-xs text-muted-foreground">Selbstkosten {euroText(e.preis.selbstkosten)} (intern)</div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium">Vorschlag {prozentText(z.startMarge)}</span>
                {z.gruende.map((g, i) => (
                  <span key={i} className="rounded-full border px-2 py-0.5 text-[11px]">
                    {g.text} {punkteText(g.punkte)}
                  </span>
                ))}
              </div>
              <input
                type="range"
                min={30}
                max={60}
                step={1}
                value={marge ?? z.startMarge}
                onChange={(ev) => setMarge(Number(ev.target.value))}
                aria-label="Marge in Prozent"
                aria-valuetext={t.aria}
                className="w-full"
              />
              <div className="text-sm">
                <span className="font-medium">{t.marge}</span>
                <span className="text-muted-foreground">, {t.margeDetail}</span>
              </div>
              {z.listenpreis != null && <div className="text-xs text-muted-foreground">nach Preisliste {euroText(z.listenpreis)}</div>}
              {marge !== null && marge !== z.startMarge && (
                <Button variant="ghost" size="sm" onClick={() => setMarge(null)}>auf Vorschlag zurück</Button>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" onClick={neuKalkulieren} disabled={arbeitet !== null}>
            {arbeitet === "neu" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Neu kalkulieren
          </Button>
          {a.kannUebernehmen && (
            <Button size="sm" onClick={() => uebernehmen(a.spanne, obergrenze != null ? euroText(obergrenze) : "", z.verfuegbar ? marge ?? z.startMarge : null)} disabled={arbeitet !== null}>
              {arbeitet === "uebernehmen" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              In Angebot übernehmen
            </Button>
          )}
        </div>
      </div>

      {z.veraltet && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Diese Kalkulation stammt von vor der Margen-Umstellung. Bitte neu rechnen, dann erscheint der Regler.
        </div>
      )}

      {a.warnung && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {a.warnung}
        </div>
      )}

      {e && (a.annahmen.length > 0 || (e.kosten?.posten?.length ?? 0) > 0) && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setDetails((d) => !d)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {details ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Kostenaufstellung und Annahmen
          </button>
          {details && (
            <div className="mt-2 space-y-3">
              {a.spanne && <p className="text-xs text-muted-foreground">Die Aufstellung zeigt den ungünstigen Fall der Spanne.</p>}
              <PostenListe titel="Selbstkosten" posten={e.kosten?.posten ?? []} summe={e.kosten?.selbstkosten} />
              <PostenListe titel="Nach Preisliste (nur Vergleich)" posten={e.preis?.posten ?? []} summe={e.preis?.listenpreis ?? e.preis?.festpreisRoh} />
              {a.annahmen.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Annahmen</div>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {a.annahmen.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {k?.computedAt && (
        <div className="mt-3 text-[10px] text-muted-foreground">
          Stand {new Date(k.computedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
        </div>
      )}
    </div>
  );
}
