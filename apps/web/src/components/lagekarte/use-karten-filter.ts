"use client";

/**
 * Lagekarte: Filter und Auswahl liegen in der URL (teilbar, überlebt Reload).
 * Schreiben per router.replace ohne Scroll und ohne History-Eintrag.
 */
import { useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { filterAusUrl, filterZuUrl, type KartenFilter } from "./filter";

const AUSWAHL_SCHLUESSEL = "lead";

export function useKartenFilter(): {
  filter: KartenFilter;
  setzeFilter: (p: Partial<KartenFilter>) => void;
  zuruecksetzen: () => void;
  auswahlId: string | null;
  waehle: (id: string | null) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  // Jüngster bekannter Stand: nach einem Schreiben gilt er sofort, auch wenn die
  // URL noch nicht nachgezogen hat (mehrere Aufrufe im selben Tick gehen nicht verloren).
  const aktuell = useRef({ gesehen: query, params: new URLSearchParams(query) });
  if (aktuell.current.gesehen !== query) {
    aktuell.current = { gesehen: query, params: new URLSearchParams(query) };
  }

  const filter = useMemo(() => filterAusUrl(new URLSearchParams(query)), [query]);
  const auswahlId = useMemo(() => new URLSearchParams(query).get(AUSWAHL_SCHLUESSEL) || null, [query]);

  const schreibe = useCallback(
    (params: URLSearchParams) => {
      aktuell.current = { gesehen: aktuell.current.gesehen, params };
      const text = params.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const setzeFilter = useCallback(
    (teil: Partial<KartenFilter>) => {
      const basis = aktuell.current.params;
      schreibe(filterZuUrl({ ...filterAusUrl(basis), ...teil }, basis));
    },
    [schreibe],
  );

  const zuruecksetzen = useCallback(() => {
    const basis = aktuell.current.params;
    // Standardfilter schreiben (entfernt alle Filter-Schlüssel), Auswahl und Fremdes bleiben.
    schreibe(filterZuUrl(filterAusUrl(new URLSearchParams()), basis));
  }, [schreibe]);

  const waehle = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(aktuell.current.params);
      if (id) params.set(AUSWAHL_SCHLUESSEL, id);
      else params.delete(AUSWAHL_SCHLUESSEL);
      schreibe(params);
    },
    [schreibe],
  );

  return { filter, setzeFilter, zuruecksetzen, auswahlId, waehle };
}
