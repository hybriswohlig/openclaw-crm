/** Reine Hilfen der Routenkarte (ohne MapLibre), auch für die Fahrt-Karte (Plan 15). */

/** Google-Polyline (Präzision 5) → [lng, lat][] */
export function polylineDekodieren(text: string): [number, number][] {
  const punkte: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < text.length) {
    for (const achse of ["lat", "lng"] as const) {
      let ergebnis = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = text.charCodeAt(index++) - 63;
        ergebnis |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= text.length);
      const delta = ergebnis & 1 ? ~(ergebnis >> 1) : ergebnis >> 1;
      if (achse === "lat") lat += delta;
      else lng += delta;
    }
    punkte.push([lng / 1e5, lat / 1e5]);
  }
  return punkte;
}

/** Grenzen aller Punkte als [[west, süd], [ost, nord]], null ohne Punkte. */
export function grenzenAus(linien: [number, number][][]): [[number, number], [number, number]] | null {
  let west = Infinity;
  let sued = Infinity;
  let ost = -Infinity;
  let nord = -Infinity;
  for (const linie of linien) {
    for (const [lng, lat] of linie) {
      if (lng < west) west = lng;
      if (lng > ost) ost = lng;
      if (lat < sued) sued = lat;
      if (lat > nord) nord = lat;
    }
  }
  if (!Number.isFinite(west)) return null;
  return [
    [west, sued],
    [ost, nord],
  ];
}

