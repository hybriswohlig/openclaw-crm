/**
 * Lagekarte, Spielbrett: Marker-Icons zur Laufzeit per Canvas zeichnen und
 * bei MapLibre registrieren (beide Themen, damit ein Themawechsel nur die
 * Icon-Namen in den Daten tauscht). Formen wie in status-form.tsx.
 */
import type { Map as MaplibreMap } from "maplibre-gl";
import { BRETT_FARBEN, STATUS_STIL, type MarkerForm, type Thema } from "@/lib/lagekarte/farben";
import { KARTEN_STATUS_REIHENFOLGE, type Firma, type KartenStatus } from "@/lib/lagekarte/typen";
import { iconName } from "./geojson";

const PIXEL_RATIO = 2;
/** Logische Kantenlänge; Form mittig, Firmen-Badge unten rechts. Alle Icons gleich groß, damit sie gleich verankert sind. */
const GROESSE = 32;
const MITTE = GROESSE / 2;
const THEMEN: Thema[] = ["hell", "dunkel"];

function pfadForm(ctx: CanvasRenderingContext2D, form: MarkerForm): void {
  const c = MITTE;
  ctx.beginPath();
  switch (form) {
    case "kreis":
      ctx.arc(c, c, 7, 0, Math.PI * 2);
      break;
    case "ring":
      ctx.arc(c, c, 6.5, 0, Math.PI * 2);
      break;
    case "raute":
      ctx.moveTo(c, c - 9);
      ctx.lineTo(c + 9, c);
      ctx.lineTo(c, c + 9);
      ctx.lineTo(c - 9, c);
      ctx.closePath();
      break;
    case "sechseck":
      for (let i = 0; i < 6; i++) {
        const w = Math.PI / 6 + (Math.PI / 3) * i;
        const x = c + 9.5 * Math.cos(w);
        const y = c + 9.5 * Math.sin(w);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case "punkt":
      ctx.arc(c, c, 4.5, 0, Math.PI * 2);
      break;
    case "kreuz":
      ctx.moveTo(c - 5, c - 5);
      ctx.lineTo(c + 5, c + 5);
      ctx.moveTo(c + 5, c - 5);
      ctx.lineTo(c - 5, c + 5);
      break;
    case "quadrat":
      ctx.roundRect(c - 6.5, c - 6.5, 13, 13, 2.5);
      break;
  }
}

function zeichneForm(ctx: CanvasRenderingContext2D, form: MarkerForm, farbe: string, halo: string, thema: Thema): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (form === "punkt") ctx.globalAlpha = 0.6;
  // Halo mit leichtem Schlagschatten: Spielfigur hebt sich vom Brett ab.
  ctx.shadowColor = thema === "hell" ? "rgba(34, 29, 22, 0.28)" : "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = 1;
  pfadForm(ctx, form);
  ctx.strokeStyle = halo;
  ctx.lineWidth = form === "kreuz" ? 5.5 : form === "ring" ? 7 : 3.5;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  pfadForm(ctx, form);
  if (form === "kreuz") {
    ctx.strokeStyle = farbe;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  } else if (form === "ring") {
    // Hohl mit dickem Rand (Innenfläche in Halofarbe, wie in der Legende).
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.strokeStyle = farbe;
    ctx.lineWidth = 3.2;
    ctx.stroke();
  } else {
    ctx.fillStyle = farbe;
    ctx.fill();
  }
  ctx.restore();
}

/** Relative Leuchtdichte (sRGB) für die Schriftfarbe im Badge. */
function istDunkel(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const kanal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * kanal((n >> 16) & 255) + 0.7152 * kanal((n >> 8) & 255) + 0.0722 * kanal(n & 255);
  return l < 0.4;
}

function zeichneBadge(ctx: CanvasRenderingContext2D, firma: Firma, halo: string): void {
  const x = MITTE + 7.5;
  const y = MITTE + 7.5;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = firma.farbe;
  ctx.fill();
  ctx.strokeStyle = halo;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = istDunkel(firma.farbe) ? "#ffffff" : "#111111";
  ctx.font = firma.kurz.length > 1 ? "600 7px Inter, system-ui" : "600 9px Inter, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(firma.kurz, x, y + 0.5);
  ctx.restore();
}

function bild(status: KartenStatus, thema: Thema, firma: Firma | null): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = GROESSE * PIXEL_RATIO;
  canvas.height = GROESSE * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  const halo = BRETT_FARBEN[thema].markerHalo;
  zeichneForm(ctx, STATUS_STIL[status].form, STATUS_STIL[status].farbe[thema], halo, thema);
  if (firma) zeichneBadge(ctx, firma, halo);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Registriert `lk-${status}-${thema}` für alle Status und beide Themen sowie
 * die Firmen-Varianten `lk-${status}-${thema}-${kurz}`. Grund-Icons nur einmal,
 * Firmen-Icons werden aktualisiert (Firmenfarbe kann sich ändern).
 */
export function registriereIcons(map: MaplibreMap, firmen: Firma[]): void {
  for (const thema of THEMEN) {
    for (const status of KARTEN_STATUS_REIHENFOLGE) {
      const grund = iconName(status, thema);
      if (!map.hasImage(grund)) {
        const daten = bild(status, thema, null);
        if (daten) map.addImage(grund, daten, { pixelRatio: PIXEL_RATIO });
      }
      for (const firma of firmen) {
        if (!firma.kurz) continue;
        const name = iconName(status, thema, firma.kurz);
        const daten = bild(status, thema, firma);
        if (!daten) continue;
        if (map.hasImage(name)) map.updateImage(name, daten);
        else map.addImage(name, daten, { pixelRatio: PIXEL_RATIO });
      }
    }
  }
}
