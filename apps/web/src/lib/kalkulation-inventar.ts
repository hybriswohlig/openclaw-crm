/**
 * Plan 15, Bauteil 14: Inventarliste der Kalkulation. Rein, ohne Datenbank.
 * Verbindet die Inventarzeilen des Leads (deal_inventory_items) mit dem, was der
 * Rechner je Position angenommen hat (`positionen` + `positionenDetails`).
 *
 * Zählweise: „N Teile erkannt“ ist die Summe der Mengen der mitzunehmenden
 * Zeilen; jede Zeile geht als eine Freitext-Position an den Rechner. Der Rechner
 * teilt Sammelzeilen („Waschmaschine und Trockner“) in Teile und rechnet Küchen
 * nicht als Stück. Darum können Zeilen, Stück und Rechner-Positionen auseinandergehen.
 */
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { Groessenklasse } from "./kalkulation-p15";
import { positionSchluessel } from "./kalkulation-versionen";

export interface InventarQuelle {
  id?: string;
  name: string;
  quantity: number;
  moveFlag: boolean;
  source: "chat" | "foto" | "operator";
  photoAttachmentId: string | null;
  volumeCbmEstimate: string | number | null;
  sizeClass?: string | null;
  dismantlingOwner: "company" | "customer" | "none";
  assemblyOwner: "company" | "customer" | "none";
}

export interface InventarListeZeile {
  id: string | null;
  key: string;
  name: string;
  menge: number;
  mitnehmen: boolean;
  herkunft: "FOTO" | "CHAT" | "MANUELL";
  fotoUrl: string | null;
  /** Katalogtreffer laut Rechner; null = kein Rechner-Ergebnis zu dieser Zeile */
  katalog: { treffer: boolean; key: string | null } | null;
  groessenklasse: Groessenklasse | null;
  volumenCbm: number | null;
  gewichtKg: number | null;
  mindestTraeger: number | null;
  trageMin: number | null;
  demontage: { min: number | null; wer: "wir" | "kunde" | "nicht_noetig" };
  montage: { min: number | null; wer: "wir" | "kunde" | "nicht_noetig" };
  /** dieses Teil erzwingt die Teamgröße (Mindestträger) */
  bestimmtTeam: boolean;
  /** Rechner-Positionen zu dieser Zeile (geteilte Sammelzeile: mehr als 1) */
  positionen: number;
  korrigiert: { von: string; am: string } | null;
  /** Zeitposten-Anpassung mit Bezug zum Teil (Schlüssel `teil.<key>`), Minuten */
  mehraufwandMin: number | null;
}

export interface InventarListe {
  zeilen: InventarListeZeile[];
  zeilenGesamt: number;
  stueck: number;
  rechnerPositionen: number;
  /** „37 Zeilen mit zusammen 76 Stück …“ */
  erklaerung: string;
}

function zahl(w: unknown): number | null {
  const n = typeof w === "number" ? w : typeof w === "string" && w.trim() !== "" ? Number(w) : NaN;
  return Number.isFinite(n) ? n : null;
}

const WER = (owner: string, zerlegt: boolean): "wir" | "kunde" | "nicht_noetig" =>
  !zerlegt ? "nicht_noetig" : owner === "customer" ? "kunde" : "wir";

export function inventarListe(
  inventar: readonly InventarQuelle[],
  e: RechnerErgebnis | null,
  opts: {
    korrekturen?: Record<string, { von: string; am: string }>;
    mehraufwand?: Record<string, number>;
    fotoUrl?: (id: string) => string;
  } = {}
): InventarListe {
  const details = new Map((e?.positionenDetails ?? []).map((d) => [d.positionId, d]));
  const jeName = new Map<string, NonNullable<RechnerErgebnis["positionen"]>>();
  for (const p of e?.positionen ?? []) {
    const k = positionSchluessel(p.name);
    jeName.set(k, [...(jeName.get(k) ?? []), p]);
  }
  const team = e?.team;
  let teamGesetzt = false;
  const zeilen: InventarListeZeile[] = inventar.map((z) => {
    const key = positionSchluessel(z.name);
    const pos = z.moveFlag ? jeName.get(key) ?? [] : [];
    const p = pos[0];
    const d = p ? details.get(p.positionId ?? p.id ?? "") : undefined;
    const zerlegt = p?.zerlegt === true;
    const menge = z.quantity > 0 ? z.quantity : 1;
    const gesamt = zahl(z.volumeCbmEstimate);
    const traeger = d?.mindestTraeger ?? p?.mindestTraeger ?? null;
    const bestimmt =
      !teamGesetzt && team?.quelle === "traeger" && !zerlegt && traeger !== null && traeger === team.groesse;
    if (bestimmt) teamGesetzt = true;
    const herkunft = z.source === "foto" ? "FOTO" : z.source === "chat" ? "CHAT" : "MANUELL";
    return {
      id: z.id ?? null,
      key,
      name: z.name.trim(),
      menge,
      mitnehmen: z.moveFlag,
      herkunft,
      fotoUrl: z.photoAttachmentId ? (opts.fotoUrl ?? ((id) => `/api/v1/inbox/attachments/${id}/content`))(z.photoAttachmentId) : null,
      katalog: p ? { treffer: d ? d.katalogTreffer : p.ungeprueft !== true, key: d?.katalogKey ?? null } : null,
      groessenklasse: (d?.groessenklasse ?? p?.groessenklasse ?? (z.sizeClass as Groessenklasse | null | undefined) ?? null) as Groessenklasse | null,
      volumenCbm: p ? p.volumenCbm : gesamt !== null ? Math.round((gesamt / menge) * 1000) / 1000 : null,
      gewichtKg: typeof p?.gewichtKg === "number" ? p.gewichtKg : null,
      mindestTraeger: traeger,
      trageMin: d ? d.trageMin : null,
      demontage: { min: d?.demontageMin ?? null, wer: WER(z.dismantlingOwner, zerlegt) },
      montage: { min: d?.montageMin ?? null, wer: WER(z.assemblyOwner, zerlegt) },
      bestimmtTeam: bestimmt,
      positionen: pos.length,
      korrigiert: z.id ? opts.korrekturen?.[z.id] ?? null : null,
      mehraufwandMin: opts.mehraufwand?.[key] ?? null,
    };
  });
  const mit = zeilen.filter((z) => z.mitnehmen);
  const stueck = mit.reduce((s, z) => s + z.menge, 0);
  const rechnerPositionen = (e?.positionen ?? []).length;
  const ohne = mit.filter((z) => z.katalog && !z.katalog.treffer).length;
  const teile = [
    `${mit.length} ${mit.length === 1 ? "Zeile" : "Zeilen"} mit zusammen ${stueck} Stück (Menge je Zeile)`,
    rechnerPositionen > 0 ? `der Rechner rechnet ${rechnerPositionen} Positionen (Sammelzeilen geteilt, Küchen nicht als Stück)` : null,
    ohne > 0 ? `${ohne} ohne Katalogtreffer` : null,
  ].filter(Boolean);
  return { zeilen, zeilenGesamt: zeilen.length, stueck, rechnerPositionen, erklaerung: `${teile.join("; ")}.` };
}
