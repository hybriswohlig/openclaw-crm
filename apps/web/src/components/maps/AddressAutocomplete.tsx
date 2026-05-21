// apps/web/src/components/maps/AddressAutocomplete.tsx
//
// Google Places (New) Autocomplete bound to a single LocationValue field.
// Server proxies keep the API key off the browser.
//
// Usage:
//   <AddressAutocomplete
//     label="Abholadresse"
//     value={loc}
//     onChange={(loc) => setLoc(loc)}
//     placeholder="Straße, Hausnummer, Stadt"
//   />
//
// Billing: one session = one UUID, kept stable for the lifetime of an
// autocomplete-then-pick cycle. We mint a new token after each pick so the
// next session is billed separately, as Google requires.
"use client";

import { useEffect, useRef, useState } from "react";

export interface LocationValue {
  line1?: string;
  postcode?: string;
  city?: string;
  countryCode?: string;
  formattedAddress?: string;
}

interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

interface Props {
  label: string;
  value: LocationValue | null;
  onChange: (loc: LocationValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Adds a "✕" clear button to the right when value is set. */
  clearable?: boolean;
}

export function AddressAutocomplete({
  label,
  value,
  onChange,
  placeholder = "Adresse eingeben…",
  disabled,
  clearable = true,
}: Props) {
  const [text, setText] = useState(formatLoc(value));
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const debouncer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the input in sync when the parent updates `value` externally
  // (e.g. after the user clicks "KI-Analyse").
  useEffect(() => {
    setText(formatLoc(value));
  }, [value?.formattedAddress, value?.line1, value?.postcode, value?.city]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  function scheduleSearch(input: string) {
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(() => runSearch(input), 250);
  }

  async function runSearch(input: string) {
    if (input.trim().length < 2) {
      setPredictions([]);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/v1/maps/places-autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, sessionToken }),
      });
      if (!resp.ok) {
        setPredictions([]);
        return;
      }
      const data = (await resp.json()) as { predictions: PlacePrediction[] };
      setPredictions(data.predictions ?? []);
      setOpen(true);
    } catch {
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  }

  async function pick(p: PlacePrediction) {
    setOpen(false);
    setLoading(true);
    try {
      const url = new URL("/api/v1/maps/places-detail", window.location.origin);
      url.searchParams.set("placeId", p.placeId);
      url.searchParams.set("sessionToken", sessionToken);
      const resp = await fetch(url.toString());
      if (!resp.ok) return;
      const data = (await resp.json()) as { location: LocationValue };
      onChange(data.location);
      setText(data.location.formattedAddress ?? formatLoc(data.location));
    } finally {
      setLoading(false);
      // Mint a fresh session token for the next pick (Google billing rule).
      setSessionToken(crypto.randomUUID());
    }
  }

  function clear() {
    onChange(null);
    setText("");
    setPredictions([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            scheduleSearch(e.target.value);
          }}
          onFocus={() => {
            if (predictions.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full rounded border px-2 py-1.5 text-sm pr-8 disabled:opacity-50"
        />
        {(text || value) && clearable && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
            aria-label="löschen"
          >
            ✕
          </button>
        )}
      </div>

      {open && predictions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded border border-border bg-background shadow-lg text-sm">
          {predictions.map((p) => (
            <li
              key={p.placeId}
              className="cursor-pointer px-3 py-2 hover:bg-muted/40 border-b border-border last:border-b-0"
              onClick={() => pick(p)}
            >
              <div className="font-medium">{p.mainText}</div>
              {p.secondaryText && (
                <div className="text-xs text-muted-foreground">{p.secondaryText}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {loading && (
        <div className="absolute right-9 top-[1.85rem] text-[10px] text-muted-foreground">
          …
        </div>
      )}
    </div>
  );
}

function formatLoc(v: LocationValue | null): string {
  if (!v) return "";
  if (v.formattedAddress) return v.formattedAddress;
  return [v.line1, v.postcode, v.city].filter(Boolean).join(", ");
}
