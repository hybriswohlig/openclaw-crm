"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, ExternalLink } from "lucide-react";
import { googleReviewUrlFieldError } from "@/lib/reviews/review-url";

const OBJECT_SLUG = "operating_companies";

const LETTERHEAD: Array<[string, string, string]> = [
  ["legal_name", "Name auf Dokumenten", "Name im Briefkopf"],
  ["phone", "Telefon (Festnetz)", "Vorwahl und Rufnummer"],
  ["whatsapp", "WhatsApp", "Mobilnummer"],
  ["email", "E-Mail", "kontakt@…"],
  ["street", "Straße", "Straße und Hausnummer"],
  ["postal_code", "PLZ", "PLZ"],
  ["city", "Ort", "Ort"],
  ["website", "Website", "https://…"],
];

function letterheadFrom(values: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug] of LETTERHEAD) {
    const value = values?.[slug];
    out[slug] = typeof value === "string" ? value : "";
  }
  return out;
}

interface RecordRow {
  id: string;
  values: Record<string, unknown>;
}

export default function OperatingCompaniesSettingsPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  // Same google_review_url the Kunden-Portal dialog edits, and that the
  // post-move review SMS reads before REVIEWS_GBP_URL_*. `saved` is the last
  // value loaded or stored, so blur does not compare against the draft.
  const [reviewUrls, setReviewUrls] = useState<Record<string, string>>({});
  const [savedReviewUrls, setSavedReviewUrls] = useState<Record<string, string>>({});
  const [reviewUrlsReady, setReviewUrlsReady] = useState(false);
  const [reviewUrlSavingFor, setReviewUrlSavingFor] = useState<string | null>(null);
  const [reviewUrlSavedFor, setReviewUrlSavedFor] = useState<string | null>(null);
  const [reviewUrlErrorFor, setReviewUrlErrorFor] = useState<Record<string, string>>({});
  const [letterhead, setLetterhead] = useState<Record<string, Record<string, string>>>({});
  const [letterheadSaved, setLetterheadSaved] = useState<Record<string, Record<string, string>>>({});
  const [letterheadSaving, setLetterheadSaving] = useState<string | null>(null);
  const [letterheadError, setLetterheadError] = useState<Record<string, string>>({});

  async function fetchRecords() {
    setLoading(true);
    setError("");
    try {
      const [recRes, portalRes] = await Promise.all([
        fetch(`/api/v1/objects/${OBJECT_SLUG}/records?limit=200`),
        fetch(`/api/v1/customer-portal-settings`),
      ]);
      if (!recRes.ok) {
        const data = await recRes.json().catch(() => ({}));
        setError(data.error?.message ?? "Gesellschaften konnten nicht geladen werden.");
        setRecords([]);
        return;
      }
      const recData = await recRes.json();
      const companyRows: RecordRow[] = recData.data?.records ?? [];
      setRecords(companyRows);
      const seeded = Object.fromEntries(companyRows.map((row) => [row.id, letterheadFrom(row.values)]));
      setLetterhead(seeded);
      setLetterheadSaved(seeded);

      if (!portalRes.ok) {
        const data = await portalRes.json().catch(() => ({}));
        setError(data.error?.message ?? "Google-Bewertungs-URLs konnten nicht geladen werden.");
        setReviewUrlsReady(false);
        return;
      }
      const portalData = await portalRes.json();
      const rows: Array<{
        operatingCompanyRecordId: string;
        googleReviewUrl: string | null;
      }> = portalData.data?.operatingCompanies ?? [];
      const loaded = Object.fromEntries(
        rows.map((r) => [r.operatingCompanyRecordId, r.googleReviewUrl ?? ""]),
      );
      setReviewUrls(loaded);
      setSavedReviewUrls(loaded);
      setReviewUrlsReady(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveReviewUrl(ocId: string, value: string) {
    const fieldError = googleReviewUrlFieldError(value);
    if (fieldError) {
      setReviewUrlErrorFor((cur) => ({ ...cur, [ocId]: fieldError }));
      return;
    }
    setReviewUrlSavingFor(ocId);
    setReviewUrlSavedFor(null);
    setReviewUrlErrorFor((cur) => {
      const next = { ...cur };
      delete next[ocId];
      return next;
    });
    try {
      const res = await fetch(`/api/v1/customer-portal-settings/${ocId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleReviewUrl: value.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReviewUrlErrorFor((cur) => ({
          ...cur,
          [ocId]: data.error?.message ?? "Google-Bewertungs-URL konnte nicht gespeichert werden.",
        }));
        return;
      }
      const stored = (data.data?.googleReviewUrl as string | null | undefined) ?? "";
      setReviewUrls((cur) => ({ ...cur, [ocId]: stored }));
      setSavedReviewUrls((cur) => ({ ...cur, [ocId]: stored }));
      setReviewUrlSavedFor(ocId);
      setTimeout(() => {
        setReviewUrlSavedFor((cur) => (cur === ocId ? null : cur));
      }, 2000);
    } finally {
      setReviewUrlSavingFor(null);
    }
  }

  async function saveLetterhead(recordId: string, slug: string, value: string) {
    const previous = letterheadSaved[recordId]?.[slug] ?? "";
    if (value === previous) return;
    setLetterheadSaving(`${recordId}:${slug}`);
    setLetterheadError((cur) => {
      const next = { ...cur };
      delete next[recordId];
      return next;
    });
    try {
      const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { [slug]: value.trim() || null } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLetterheadError((cur) => ({
          ...cur,
          [recordId]: data.error?.message ?? "Briefkopf konnte nicht gespeichert werden.",
        }));
        return;
      }
      const stored = typeof data.data?.values?.[slug] === "string" ? data.data.values[slug] : value.trim();
      setLetterhead((cur) => ({ ...cur, [recordId]: { ...cur[recordId], [slug]: stored } }));
      setLetterheadSaved((cur) => ({ ...cur, [recordId]: { ...cur[recordId], [slug]: stored } }));
    } finally {
      setLetterheadSaving(null);
    }
  }

  useEffect(() => {
    fetchRecords();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            name: name.trim(),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        }),
      });
      if (res.ok) {
        setName("");
        setNotes("");
        fetchRecords();
      } else {
        const data = await res.json();
        setError(data.error?.message ?? "Gesellschaft konnte nicht angelegt werden");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(recordId: string) {
    if (!confirm("Diese Gesellschaft entfernen? Deals, die darauf verweisen, verlieren die Verknüpfung.")) {
      return;
    }
    const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records/${recordId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
    } else {
      const data = await res.json();
      setError(data.error?.message ?? "Gesellschaft konnte nicht entfernt werden");
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Gesellschaften</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Deine Umzugsfirmen (Marken oder Gesellschaften). Jeder Deal kann der Gesellschaft zugeordnet
        werden, bei der die Anfrage eingegangen ist, unabhängig von der Firma des Kunden auf dem Deal.
      </p>

      <form onSubmit={handleAdd} className="space-y-4 mb-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Gesellschaft hinzufügen</h2>
        <div className="space-y-2">
          <Label htmlFor="oc-name">Name</Label>
          <Input
            id="oc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Kottke Umzüge GmbH"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="oc-notes">Notizen (optional)</Label>
          <Input
            id="oc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Region, rechtlicher Hinweis, …"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={adding || !name.trim()}>
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" />
              Hinzufügen
            </>
          )}
        </Button>
      </form>

      <h2 className="text-sm font-medium mb-3">Deine Gesellschaften</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
        </p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch keine Gesellschaften. Lege mindestens eine an, um Deals der richtigen Firma zuzuordnen.
        </p>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => {
            const displayName = String(r.values?.name ?? "Unbenannt");
            const note = r.values?.notes ? String(r.values.notes) : null;
            const reviewUrl = reviewUrls[r.id] ?? "";
            const isSaving = reviewUrlSavingFor === r.id;
            const justSaved = reviewUrlSavedFor === r.id;
            const reviewError = reviewUrlErrorFor[r.id];
            return (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="font-medium truncate">{displayName}</p>
                    {note && <p className="text-xs text-muted-foreground truncate">{note}</p>}
                    <Link
                      href={`/objects/${OBJECT_SLUG}/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                    >
                      Datensatz öffnen <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {LETTERHEAD.map(([slug, label, placeholder]) => (
                      <div key={slug} className="space-y-1">
                        <Label htmlFor={`oc-${slug}-${r.id}`} className="text-xs text-muted-foreground">
                          {label}
                        </Label>
                        <Input
                          id={`oc-${slug}-${r.id}`}
                          value={letterhead[r.id]?.[slug] ?? ""}
                          placeholder={placeholder}
                          spellCheck={false}
                          onChange={(e) =>
                            setLetterhead((cur) => ({
                              ...cur,
                              [r.id]: { ...cur[r.id], [slug]: e.target.value },
                            }))
                          }
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            setLetterhead((cur) => ({
                              ...cur,
                              [r.id]: { ...cur[r.id], [slug]: next },
                            }));
                            void saveLetterhead(r.id, slug, next);
                          }}
                          className="h-8 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  {letterheadSaving?.startsWith(`${r.id}:`) && (
                    <p className="text-xs text-muted-foreground">Speichert…</p>
                  )}
                  {letterheadError[r.id] && (
                    <p className="text-xs text-destructive">{letterheadError[r.id]}</p>
                  )}
                  {reviewUrlsReady && (
                    <div className="space-y-1">
                      <Label htmlFor={`oc-review-url-${r.id}`} className="text-xs text-muted-foreground">
                        Google-Bewertungs-URL
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Für die Bewertungs-SMS nach dem Umzug und die Danke-Seite im Kundenportal.
                        Leer lassen, dann gilt die Umgebungsvariable.
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`oc-review-url-${r.id}`}
                          value={reviewUrl}
                          placeholder="https://g.page/r/…/review"
                          spellCheck={false}
                          onChange={(e) =>
                            setReviewUrls((cur) => ({ ...cur, [r.id]: e.target.value }))
                          }
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            setReviewUrls((cur) => ({ ...cur, [r.id]: next }));
                            if (next === (savedReviewUrls[r.id] ?? "")) {
                              setReviewUrlErrorFor((cur) => {
                                const copy = { ...cur };
                                delete copy[r.id];
                                return copy;
                              });
                              return;
                            }
                            void saveReviewUrl(r.id, next);
                          }}
                          className="h-8 text-sm"
                        />
                        {isSaving && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                        )}
                        {justSaved && (
                          <span className="text-xs text-emerald-600 shrink-0">Gespeichert</span>
                        )}
                      </div>
                      {reviewError && <p className="text-xs text-destructive">{reviewError}</p>}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(r.id)}
                  aria-label={`${displayName} entfernen`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
