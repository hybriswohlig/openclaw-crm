// apps/web/src/app/(dashboard)/settings/depots/page.tsx
//
// Anfahrtadressen — manage the depots (Sixt Truck Center locations or any
// other start point) the Zeitschätzung & Preis-Kalkulator routes over.
//
// The calculator ranks every active depot by real road distance to the
// pickup and auto-picks the nearest, so adding a depot closer to a job's
// region (Pforzheim, Tübingen, …) immediately improves the suggestion.
//
// Coordinates come straight from the Google address pick (placeDetail now
// returns lat/lng), so a depot is only valid once an address has been
// selected from the dropdown.
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, MapPin } from "lucide-react";
import {
  AddressAutocomplete,
  type LocationValue,
} from "@/components/maps/AddressAutocomplete";

const OBJECT_SLUG = "transport_depots";

interface DepotRow {
  id: string;
  values: Record<string, unknown>;
}

export default function DepotsSettingsPage() {
  const [records, setRecords] = useState<DepotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Add-form state ──────────────────────────────────────────────
  const [name, setName] = useState("");
  const [address, setAddress] = useState<LocationValue | null>(null);
  const [radius, setRadius] = useState("40");
  const [plzPrefixes, setPlzPrefixes] = useState("");
  const [adding, setAdding] = useState(false);

  async function fetchRecords() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records?limit=200`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? "Depots konnten nicht geladen werden.");
        setRecords([]);
        return;
      }
      const data = await res.json();
      setRecords(data.data?.records ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRecords();
  }, []);

  const addressHasCoords =
    !!address && typeof address.lat === "number" && typeof address.lng === "number";

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!addressHasCoords) {
      setError(
        "Bitte die Adresse aus der Google-Vorschlagsliste auswählen, damit Koordinaten gesetzt werden."
      );
      return;
    }
    setAdding(true);
    setError("");
    try {
      const addr = address!;
      const parsedRadius = Number(radius);
      const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            name: name.trim(),
            address: {
              line1: addr.line1,
              postcode: addr.postcode,
              city: addr.city,
              countryCode: addr.countryCode,
              formattedAddress: addr.formattedAddress,
              lat: addr.lat,
              lng: addr.lng,
            },
            lat: addr.lat,
            lng: addr.lng,
            city_tag: deriveCityTag(addr.city ?? ""),
            ...(plzPrefixes.trim() ? { plz_prefixes: plzPrefixes.trim() } : {}),
            ...(Number.isFinite(parsedRadius) && parsedRadius > 0
              ? { service_radius_km: parsedRadius }
              : {}),
            active: true,
          },
        }),
      });
      if (res.ok) {
        setName("");
        setAddress(null);
        setRadius("40");
        setPlzPrefixes("");
        fetchRecords();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? "Depot konnte nicht angelegt werden.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(rec: DepotRow) {
    const next = !(depotBool(rec.values, "active") ?? true);
    // Optimistic flip.
    setRecords((prev) =>
      prev.map((r) => (r.id === rec.id ? { ...r, values: { ...r.values, active: next } } : r))
    );
    const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records/${rec.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: { active: next } }),
    });
    if (!res.ok) {
      // Roll back on failure.
      setRecords((prev) =>
        prev.map((r) => (r.id === rec.id ? { ...r, values: { ...r.values, active: !next } } : r))
      );
      const data = await res.json().catch(() => ({}));
      setError(data.error?.message ?? "Status konnte nicht geändert werden.");
    }
  }

  async function handleRemove(rec: DepotRow) {
    const label = String(rec.values?.name ?? "dieses Depot");
    if (!confirm(`„${label}" entfernen? Aufträge, die es nutzen, fallen auf das nächste Depot zurück.`)) {
      return;
    }
    const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records/${rec.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRecords((prev) => prev.filter((r) => r.id !== rec.id));
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error?.message ?? "Depot konnte nicht entfernt werden.");
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Anfahrtadressen (Depots)</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Start- und Endpunkte für die Routenberechnung im Preis-Kalkulator. Der Kalkulator
        wählt automatisch das Depot, das der Abholadresse am nächsten liegt, und zeigt die
        Alternativen mit Entfernung an. Lege weitere Sixt Center (z. B. Pforzheim, Tübingen,
        Sindelfingen) an, damit Aufträge in diesen Regionen das passende Depot vorgeschlagen
        bekommen.
      </p>

      <form onSubmit={handleAdd} className="space-y-4 mb-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Depot hinzufügen</h2>
        <div className="space-y-2">
          <Label htmlFor="depot-name">Name</Label>
          <Input
            id="depot-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Sixt Truck Center Pforzheim"
            required
          />
        </div>
        <div className="space-y-2">
          <AddressAutocomplete
            label="Adresse (aus Google-Liste wählen)"
            value={address}
            onChange={setAddress}
            placeholder="Straße + Nr., PLZ Stadt"
          />
          {address && !addressHasCoords && (
            <p className="text-xs text-amber-600">
              Adresse aus der Vorschlagsliste auswählen, damit Koordinaten gesetzt werden.
            </p>
          )}
          {addressHasCoords && (
            <p className="text-xs text-muted-foreground">
              Koordinaten: {address!.lat!.toFixed(4)}, {address!.lng!.toFixed(4)}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="depot-radius">Einsatzradius (km)</Label>
            <Input
              id="depot-radius"
              type="number"
              min={1}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              placeholder="40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="depot-plz">PLZ-Präfixe (optional)</Label>
            <Input
              id="depot-plz"
              value={plzPrefixes}
              onChange={(e) => setPlzPrefixes(e.target.value)}
              placeholder="z. B. 75,76"
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={adding || !name.trim() || !addressHasCoords}>
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" />
              Depot anlegen
            </>
          )}
        </Button>
      </form>

      <h2 className="text-sm font-medium mb-3">Deine Depots</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
        </p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch keine Depots. Lege mindestens eines an, damit der Kalkulator eine Route berechnen kann.
        </p>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => {
            const displayName = String(r.values?.name ?? "Unbenannt");
            const addr = depotAddress(r.values);
            const plz = typeof r.values?.plz_prefixes === "string" ? r.values.plz_prefixes : null;
            const radiusKm = depotNum(r.values, "service_radius_km");
            const active = depotBool(r.values, "active") ?? true;
            return (
              <li
                key={r.id}
                className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 ${
                  active ? "border-border" : "border-border/50 opacity-60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {displayName}
                  </p>
                  {addr && <p className="text-xs text-muted-foreground truncate">{addr}</p>}
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {plz ? `PLZ ${plz}` : "keine PLZ-Präfixe"}
                    {radiusKm != null ? ` · ${radiusKm} km Radius` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleActive(r)}
                    />
                    aktiv
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(r)}
                    aria-label={`${displayName} entfernen`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── value readers (handle both legacy seed + new address shape) ──────────

function depotAddress(values: Record<string, unknown>): string {
  const a = values.address;
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    if (typeof o.formattedAddress === "string" && o.formattedAddress) return o.formattedAddress;
    if (typeof o.address === "string" && o.address) return o.address; // legacy seed shape
    const parts = [o.line1, o.postcode, o.city].filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    if (parts.length) return parts.join(", ");
  }
  return "";
}

function depotNum(values: Record<string, unknown>, slug: string): number | null {
  const v = values[slug];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function depotBool(values: Record<string, unknown>, slug: string): boolean | null {
  const v = values[slug];
  return typeof v === "boolean" ? v : null;
}

/** Lowercase, ASCII-folded city keyword used by the legacy PLZ auto-pick. */
function deriveCityTag(city: string): string {
  return city
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
}
