"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, ExternalLink } from "lucide-react";

const OBJECT_SLUG = "operating_companies";

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

  async function fetchRecords() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records?limit=200`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message ?? "Could not load operating companies.");
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
        setError(data.error?.message ?? "Failed to create company");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(recordId: string) {
    if (!confirm("Remove this operating company? Deals that reference it will lose the link.")) {
      return;
    }
    const res = await fetch(`/api/v1/objects/${OBJECT_SLUG}/records/${recordId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
    } else {
      const data = await res.json();
      setError(data.error?.message ?? "Failed to remove");
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Operating companies</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Your moving businesses (brands or legal entities). Each deal can be assigned to the company
        that received the inquiry, separate from the client&apos;s company on the deal record.
      </p>

      <form onSubmit={handleAdd} className="space-y-4 mb-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Add operating company</h2>
        <div className="space-y-2">
          <Label htmlFor="oc-name">Name</Label>
          <Input
            id="oc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North Moves GmbH"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="oc-notes">Notes (optional)</Label>
          <Input
            id="oc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Region, legal note, …"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={adding || !name.trim()}>
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" />
              Add company
            </>
          )}
        </Button>
      </form>

      <h2 className="text-sm font-medium mb-3">Your companies</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No operating companies yet. Add at least one so you can assign deals to the right business.
        </p>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => {
            const displayName = String(r.values?.name ?? "Unnamed");
            const note = r.values?.notes ? String(r.values.notes) : null;
            return (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{displayName}</p>
                  {note && <p className="text-xs text-muted-foreground truncate">{note}</p>}
                  <Link
                    href={`/objects/${OBJECT_SLUG}/${r.id}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                  >
                    Open record <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(r.id)}
                  aria-label={`Remove ${displayName}`}
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
