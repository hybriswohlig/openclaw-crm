"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Phone, Route as RouteIcon } from "lucide-react";

export interface MapDeal {
  dealId: string;
  dealNumber: string | null;
  name: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  moveFromAddress: string | null;
  moveToAddress: string | null;
}

const GEOCODE_CACHE_KEY = "kottke:geocode:v1";

type LatLng = { lat: number; lng: number };

function readCache(): Record<string, LatLng> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GEOCODE_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LatLng>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, LatLng>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // quota exceeded, ignore
  }
}

async function geocodeOne(address: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    address
  )}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

function stageToTone(
  stageTitle: string | null
): "live" | "confirmed" | "quote" | "request" | "default" {
  if (!stageTitle) return "default";
  const t = stageTitle.toLowerCase();
  if (t.includes("läuft") || t.includes("laeuft") || t.includes("running")) return "live";
  if (t.includes("bestätigt") || t.includes("bestaetigt") || t.includes("confirmed"))
    return "confirmed";
  if (t.includes("angebot") || t.includes("quote") || t.includes("offer")) return "quote";
  if (t.includes("anfrage") || t.includes("request")) return "request";
  return "default";
}

const TONE_COLOR: Record<ReturnType<typeof stageToTone>, string> = {
  live: "oklch(0.58 0.12 45)", // accent
  confirmed: "#221d16", // ink
  quote: "#c6a66b",
  request: "#8a7f72",
  default: "#5a5046",
};

function buildIcon(tone: ReturnType<typeof stageToTone>) {
  const color = TONE_COLOR[tone];
  const html = `
    <div style="position:relative;width:24px;height:30px;display:flex;align-items:center;justify-content:center;">
      ${
        tone === "live"
          ? `<span style="position:absolute;width:30px;height:30px;border-radius:50%;background:${color};opacity:.25;animation:kottke-pin-pulse 2s ease-out infinite;"></span>`
          : ""
      }
      <svg viewBox="0 0 24 30" width="24" height="30" style="position:relative;">
        <path d="M 12 1 Q 4 1, 4 9 Q 4 17, 12 28 Q 20 17, 20 9 Q 20 1, 12 1 Z" fill="${color}" stroke="#fff" stroke-width="1.2"/>
        <circle cx="12" cy="9" r="3.4" fill="#fff"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html,
    className: "kottke-pin",
    iconSize: [24, 30],
    iconAnchor: [12, 28],
    popupAnchor: [0, -26],
  });
}

export function MapView({ deals }: { deals: MapDeal[] }) {
  const [cache, setCache] = useState<Record<string, LatLng>>(() => readCache());
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef(false);

  // Collect addresses we need to geocode that aren't in cache yet
  const addresses = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) {
      if (d.moveFromAddress) set.add(d.moveFromAddress);
      if (d.moveToAddress) set.add(d.moveToAddress);
    }
    return Array.from(set);
  }, [deals]);

  useEffect(() => {
    const missing = addresses.filter((a) => !cache[a]);
    if (missing.length === 0) return;
    queueRef.current = missing;

    async function run() {
      if (runningRef.current) return;
      runningRef.current = true;
      while (queueRef.current.length > 0) {
        const addr = queueRef.current.shift()!;
        const result = await geocodeOne(addr);
        if (result) {
          setCache((prev) => {
            const next = { ...prev, [addr]: result };
            writeCache(next);
            return next;
          });
        }
        // Respect Nominatim's 1 req/sec policy
        await new Promise((r) => setTimeout(r, 1100));
      }
      runningRef.current = false;
    }
    run();
  }, [addresses, cache]);

  // Resolved pins: prefer the "from" location of each deal as the deal pin
  const pins = useMemo(() => {
    return deals
      .map((d) => {
        const fromLatLng = d.moveFromAddress ? cache[d.moveFromAddress] : null;
        const toLatLng = d.moveToAddress ? cache[d.moveToAddress] : null;
        const tone = stageToTone(d.stage?.title ?? null);
        return {
          deal: d,
          tone,
          from: fromLatLng,
          to: toLatLng,
        };
      })
      .filter((p) => p.from || p.to);
  }, [deals, cache]);

  // Pick center & zoom — average all known coords; fallback to Hamburg
  const center: LatLng = useMemo(() => {
    const coords = pins.flatMap((p) =>
      [p.from, p.to].filter((x): x is LatLng => x != null)
    );
    if (coords.length === 0) return { lat: 53.55, lng: 9.99 }; // Hamburg default
    const avgLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
    const avgLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
    return { lat: avgLat, lng: avgLng };
  }, [pins]);

  // Focus deal: live first, else first deal
  const focus = useMemo(
    () => pins.find((p) => p.tone === "live") ?? pins[0] ?? null,
    [pins]
  );

  const totalToGeocode = addresses.filter((a) => !cache[a]).length;

  return (
    <div className="relative">
      <div
        style={{
          height: "min(70vh, 600px)",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid var(--line)",
        }}
      >
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="bottomright" />

          {pins.map((p) => {
            if (!p.from) return null;
            return (
              <Marker
                key={p.deal.dealId}
                position={[p.from.lat, p.from.lng]}
                icon={buildIcon(p.tone)}
              >
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    {p.deal.dealNumber && (
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontSize: 11,
                          color: "#8a7f72",
                          marginBottom: 2,
                        }}
                      >
                        {p.deal.dealNumber}
                      </div>
                    )}
                    <div style={{ fontWeight: 500, fontSize: 13 }}>
                      {p.deal.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#5a5046",
                        marginTop: 4,
                      }}
                    >
                      {p.deal.moveFromAddress ?? "—"}
                      {" → "}
                      {p.deal.moveToAddress ?? "—"}
                    </div>
                    {p.deal.stage && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: p.deal.stage.color,
                        }}
                      >
                        {p.deal.stage.title}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {focus && focus.from && focus.to && (
            <Polyline
              positions={[
                [focus.from.lat, focus.from.lng],
                [focus.to.lat, focus.to.lng],
              ]}
              pathOptions={{
                color: TONE_COLOR.live,
                weight: 3,
                opacity: 0.85,
              }}
            />
          )}
        </MapContainer>
      </div>

      {/* Floating overlay card */}
      {focus && (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            width: 280,
            background: "rgba(255,255,255,.94)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: 14,
            boxShadow: "0 8px 24px -6px rgba(0,0,0,.15)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: TONE_COLOR[focus.tone],
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: TONE_COLOR[focus.tone],
              }}
            />
            {focus.tone === "live" ? "Live" : focus.deal.stage?.title ?? "Auftrag"}
            {focus.deal.dealNumber ? ` · ${focus.deal.dealNumber}` : ""}
          </div>
          <div style={{ fontWeight: 500, fontSize: 14, marginTop: 4 }}>
            {focus.deal.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-muted)",
              marginTop: 2,
            }}
          >
            {focus.deal.moveFromAddress ?? "—"} → {focus.deal.moveToAddress ?? "—"}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
            <button className="k-btn sm" style={{ flex: 1, fontSize: 11.5 }}>
              <Phone size={11} />
              Anruf
            </button>
            <a
              href={`/objects/deals/${focus.deal.dealId}`}
              className="k-btn sm"
              style={{
                flex: 1,
                fontSize: 11.5,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              <RouteIcon size={11} />
              Öffnen
            </a>
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "rgba(255,255,255,.94)",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 11,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          border: "1px solid var(--line)",
          zIndex: 1000,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: TONE_COLOR.live,
            }}
          />
          Läuft
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: TONE_COLOR.confirmed,
            }}
          />
          Bestätigt
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: TONE_COLOR.quote,
            }}
          />
          Angebot
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: TONE_COLOR.request,
            }}
          />
          Anfrage
        </div>
      </div>

      {/* Geocoding progress */}
      {totalToGeocode > 0 && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(34,29,22,.85)",
            color: "var(--paper)",
            borderRadius: 999,
            padding: "5px 12px",
            fontSize: 11,
            fontFamily: "var(--f-mono)",
            zIndex: 1000,
          }}
        >
          Adressen werden geladen … ({addresses.length - totalToGeocode}/{addresses.length})
        </div>
      )}

      <style>{`@keyframes kottke-pin-pulse {
        0%{transform:scale(0.6); opacity:.45;}
        70%{transform:scale(1.6); opacity:0;}
        100%{transform:scale(0.6); opacity:0;}
      }`}</style>
    </div>
  );
}
