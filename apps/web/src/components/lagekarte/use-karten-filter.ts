"use client";

/**
 * Lagekarte: Filter und Auswahl liegen in der URL (teilbar, überlebt Reload).
 * Schreiben per window.history.replaceState: ohne History-Eintrag, ohne Scroll
 * und ohne Server-Rundlauf. Next.js (ab 14.1) gleicht useSearchParams damit ab;
 * router.replace hätte je Klick die Seite neu vom Server geholt (spürbare
 * Verzögerung bei Chips und Lead-Auswahl).
 *
 * Router-Zustand (Grok 3, geprüft in Next 15.5.12, app-router.js): Next patcht
 * replaceState und kopiert bei fremdem `data` selbst `__NA` und den Router-Baum
 * aus dem aktuellen Eintrag (copyNextJsInternalHistoryState), deshalb bleibt
 * „Zurück“ (z. B. von „Aufgaben“ auf /home) clientseitig. NICHT
 * `window.history.state` übergeben: Ein Objekt mit `__NA` hält Next für einen
 * eigenen Aufruf und gleicht useSearchParams dann nicht ab (Filter und Auswahl
 * reagierten nicht mehr). Deshalb ein leeres Objekt.
 *
 * Der Suchtext gehört nicht in die URL (Ruling 12): `alteSuche` liefert den
 * Suchtext eines alten Links mit `q=` einmal, das `q` verschwindet sofort.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ALTE_SUCHE_SCHLUESSEL, alteSucheAusUrl, filterAusUrl, filterZuUrl, type KartenFilter } from "./filter";

const AUSWAHL_SCHLUESSEL = "lead";

export function useKartenFilter(): {
  filter: KartenFilter;
  setzeFilter: (p: Partial<KartenFilter>) => void;
  zuruecksetzen: () => void;
  auswahlId: string | null;
  waehle: (id: string | null) => void;
  /** Suchtext aus einem alten Link (`?q=`), beim ersten Rendern gelesen; sonst null. */
  alteSuche: string | null;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  // Jüngster bekannter Stand: nach einem Schreiben gilt er sofort, auch wenn die
  // URL noch nicht nachgezogen hat (mehrere Aufrufe im selben Tick gehen nicht verloren).
  const aktuell = useRef({ gesehen: query, params: new URLSearchParams(query) });
  if (aktuell.current.gesehen !== query) {
    aktuell.current = { gesehen: query, params: new URLSearchParams(query) };
  }

  const [alteSuche] = useState(() => alteSucheAusUrl(new URLSearchParams(query)));

  const filter = useMemo(() => filterAusUrl(new URLSearchParams(query)), [query]);
  const auswahlId = useMemo(() => new URLSearchParams(query).get(AUSWAHL_SCHLUESSEL) || null, [query]);

  const schreibe = useCallback(
    (params: URLSearchParams) => {
      aktuell.current = { gesehen: aktuell.current.gesehen, params };
      const text = params.toString();
      window.history.replaceState({}, "", text ? `${pathname}?${text}` : pathname);
    },
    [pathname],
  );

  // Alter Link mit Suchtext: q sofort aus der Adresse nehmen (der Container hat ihn übernommen).
  const hatAlteSuche = new URLSearchParams(query).has(ALTE_SUCHE_SCHLUESSEL);
  useEffect(() => {
    if (!hatAlteSuche) return;
    const params = new URLSearchParams(aktuell.current.params);
    params.delete(ALTE_SUCHE_SCHLUESSEL);
    schreibe(params);
  }, [hatAlteSuche, schreibe]);

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

  return { filter, setzeFilter, zuruecksetzen, auswahlId, waehle, alteSuche };
}
