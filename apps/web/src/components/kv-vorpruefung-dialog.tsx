"use client";

/**
 * Fenster „Es fehlen noch Angaben“ vor KV, AB oder Rechnung.
 *
 * Pflichtangaben, ohne die die Vorlage auf crm-tools abbricht, lassen sich
 * hier direkt nachtragen und werden dauerhaft am Lead gespeichert. Umzugsgut
 * und Preis sind keine einzelnen Felder: dafür gibt es einen Sprung an die
 * richtige Stelle. Genutzt im Posteingang und in der Auftragsübersicht.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LeadContext } from "@/lib/deal-doc-data";
import { AddressAutocomplete, type LocationValue } from "@/components/maps/AddressAutocomplete";
import {
  kvVorpruefung,
  type DokumentArt,
  type HinweisArt,
  type KvHinweisDaten,
  type PflichtFeld,
} from "@/lib/kv-vorpruefung";

const DOK_NAME: Record<DokumentArt, string> = {
  KV: "den Kostenvoranschlag",
  AB: "die Auftragsbestätigung",
  RE: "die Rechnung",
};

const ZIEL_TEXT: Record<HinweisArt, string> = {
  umzugsgut: "Umzugsgut öffnen",
  preis: "Kalkulation öffnen",
};

export function KvVorpruefungDialog({
  documentType,
  dealRecordId,
  leadContext,
  hinweisDaten,
  ziele,
  onZiel,
  onWeiter,
  onAbbrechen,
  children,
}: {
  documentType: DokumentArt;
  dealRecordId: string;
  leadContext: LeadContext | null;
  hinweisDaten: KvHinweisDaten | null;
  /** Welche Sprungziele es in dieser Ansicht gibt. */
  ziele: HinweisArt[];
  onZiel: (ziel: HinweisArt) => void;
  /** Nach dem Speichern: frischer Stand vom Server. */
  onWeiter: (ctx: LeadContext | null, daten: KvHinweisDaten | null) => void;
  onAbbrechen: () => void;
  /** Zusätzliche Knöpfe, z. B. „KI-Analyse aus Chat“. */
  children?: React.ReactNode;
}) {
  const pruefung = useMemo(
    () => kvVorpruefung({ ctx: leadContext, daten: hinweisDaten, documentType }),
    [leadContext, hinweisDaten, documentType]
  );
  const start = useMemo(
    () => Object.fromEntries(pruefung.felder.map((f) => [f.feld, f.wert])) as Record<PflichtFeld, string>,
    [pruefung]
  );
  const [werte, setWerte] = useState<Record<PflichtFeld, string>>(start);
  // Adressen strukturiert über die Google-Vorschläge, wie in der Auftragsübersicht.
  const [orte, setOrte] = useState<{ auszug: LocationValue | null; einzug: LocationValue | null }>(() => ({
    auszug: alsOrt(leadContext?.move_from_address),
    einzug: alsOrt(leadContext?.move_to_address),
  }));
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const leer = (feld: PflichtFeld) =>
    feld === "auszug" || feld === "einzug" ? !orte[feld]?.line1?.trim() : !werte[feld]?.trim();
  const bereit =
    pruefung.felder.every((f) => !leer(f.feld)) && !pruefung.firmaFehlt && !pruefung.preisFehlt && !speichert;

  async function speichernUndWeiter() {
    if (!bereit) return;
    setSpeichert(true);
    setFehler(null);
    try {
      const values: Record<string, unknown> = {};
      for (const f of pruefung.felder) {
        if (f.feld === "auszug" || f.feld === "einzug") {
          const ort = orte[f.feld];
          const vorher = f.feld === "auszug" ? leadContext?.move_from_address : leadContext?.move_to_address;
          if (ort && JSON.stringify(ohneFormat(ort)) !== JSON.stringify(ohneFormat(alsOrt(vorher)))) {
            values[f.feld === "auszug" ? "move_from_address" : "move_to_address"] = ohneFormat(ort);
          }
          continue;
        }
        const neu = werte[f.feld].trim();
        if (neu === f.wert.trim()) continue;
        if (f.feld === "datum") values.move_date = neu;
        // Nur ohne verknüpfte Person: dann ist der Lead-Name die Quelle.
        if (f.feld === "kundenname") values.name = neu;
      }
      if (Object.keys(values).length > 0) {
        const res = await fetch(`/api/v1/objects/deals/records/${dealRecordId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setFehler(j?.error?.message ?? "Speichern hat nicht geklappt. Bitte erneut versuchen.");
          return;
        }
      }
      const res = await fetch(`/api/v1/deals/${dealRecordId}/auftrag`);
      const j = res.ok
        ? ((await res.json()) as { data?: { leadContext?: LeadContext | null; kvHinweise?: KvHinweisDaten | null } })
        : null;
      onWeiter(j?.data?.leadContext ?? null, j?.data?.kvHinweise ?? null);
    } catch {
      setFehler("Verbindungsfehler beim Speichern.");
    } finally {
      setSpeichert(false);
    }
  }

  // Kundenname mit verknüpfter Person ändert man an der Person, nicht hier.
  const nameGesperrt = !!leadContext?.person_name && !leer("kundenname");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl">
        <h3 className="text-sm font-semibold">Angaben für {DOK_NAME[documentType]}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Fehlende Angaben direkt eintragen. Sie werden am Lead gespeichert.
        </p>

        <div className="mt-4 space-y-3">
          {pruefung.felder.map((f) =>
            f.feld === "auszug" || f.feld === "einzug" ? (
              <div key={f.feld} className={leer(f.feld) ? "rounded-md ring-1 ring-destructive/50" : ""}>
                <AddressAutocomplete
                  label={leer(f.feld) ? `${f.label} (fehlt)` : f.label}
                  value={orte[f.feld]}
                  onChange={(loc) => setOrte((o) => ({ ...o, [f.feld]: loc }))}
                  placeholder="Adresse suchen und Vorschlag wählen…"
                />
              </div>
            ) : (
              <label key={f.feld} className="block">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {f.label}
                  {leer(f.feld) && <span className="text-[10px] font-normal text-destructive">fehlt</span>}
                </span>
                <input
                  type={f.feld === "datum" ? "date" : "text"}
                  value={werte[f.feld]}
                  disabled={f.feld === "kundenname" && nameGesperrt}
                  onChange={(e) => setWerte((w) => ({ ...w, [f.feld]: e.target.value }))}
                  placeholder={f.feld === "kundenname" ? "Vorname Nachname" : undefined}
                  className={`mt-1 h-9 w-full rounded-md border bg-background px-2.5 text-sm disabled:opacity-60 ${
                    leer(f.feld) ? "border-destructive/60" : "border-border"
                  }`}
                />
              </label>
            )
          )}
        </div>

        {pruefung.firmaFehlt && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Am Lead fehlt die Firma (Kottke oder Ceylan). Bitte unter „Attribute“ am Lead setzen.
          </p>
        )}
        {pruefung.preisFehlt && (
          <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Für {DOK_NAME[documentType]} braucht es zuerst ein gespeichertes Angebot.
            {ziele.includes("preis") && (
              <button type="button" onClick={() => onZiel("preis")} className="ml-1 font-medium underline underline-offset-2">
                Kalkulation öffnen
              </button>
            )}
          </div>
        )}

        {pruefung.hinweise.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Hinweise (blockieren nicht)
            </div>
            {pruefung.hinweise.map((h) => (
              <div key={h.art} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                {h.text}
                {ziele.includes(h.art) && (
                  <button type="button" onClick={() => onZiel(h.art)} className="ml-1 font-medium underline underline-offset-2">
                    {ZIEL_TEXT[h.art]}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {fehler && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{fehler}</p>
        )}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => void speichernUndWeiter()}
            disabled={!bereit}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            {speichert ? "Wird gespeichert…" : `Speichern und ${documentType === "RE" ? "Rechnung" : documentType} erstellen`}
          </button>
          {children}
          <button
            type="button"
            onClick={onAbbrechen}
            className="inline-flex h-9 w-full items-center justify-center rounded-md text-sm text-muted-foreground hover:bg-muted"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

/** Gespeicherten Ort (jsonb) als Wert für die Autovervollständigung. */
function alsOrt(v: unknown): LocationValue | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const ort: LocationValue = { line1: s(o.line1), postcode: s(o.postcode), city: s(o.city), countryCode: s(o.countryCode) };
  return ort.line1 ? ort : null;
}

/** Wie in der Auftragsübersicht: nur die Felder speichern, die der Lead kennt. */
function ohneFormat(v: LocationValue | null): Record<string, string | undefined> | null {
  if (!v) return null;
  return { line1: v.line1, postcode: v.postcode, city: v.city, countryCode: v.countryCode };
}
