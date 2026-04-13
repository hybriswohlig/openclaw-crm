"use client";

import { useState, useEffect } from "react";
import { Plus, Store, MapPin, Calendar, Users, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TradeFair {
  id: string;
  name: string;
  location: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  teamName: string | null;
}

interface Team {
  id: string;
  name: string;
}

function TradeFairForm({
  fair,
  teams,
  onSave,
  onCancel,
}: {
  fair?: TradeFair | null;
  teams: Team[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(fair?.name ?? "");
  const [location, setLocation] = useState(fair?.location ?? "");
  const [country, setCountry] = useState(fair?.country ?? "");
  const [startDate, setStartDate] = useState(fair?.startDate ?? "");
  const [endDate, setEndDate] = useState(fair?.endDate ?? "");
  const [description, setDescription] = useState(fair?.description ?? "");
  const [teamId, setTeamId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setSaving(true);
    try {
      const body = { name, location, country, startDate, endDate, description, teamId: teamId || null };
      const url = fair ? `/api/v1/trade-fairs/${fair.id}` : "/api/v1/trade-fairs";
      const method = fair ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save");
        return;
      }
      onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border p-5 bg-card">
      <h3 className="font-semibold">{fair ? "Edit Trade Fair" : "New Trade Fair"}</h3>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1">
          <label className="text-sm font-medium">Name *</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Analytica 2025" required />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">City / Venue</label>
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Munich, Messe München" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Country</label>
          <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Germany" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Start Date</label>
          <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">End Date</label>
          <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Team</label>
          <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">— select team —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-sm font-medium">Description / Notes</label>
          <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Booth number, key focus areas…" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {fair ? "Save Changes" : "Create Fair"}
        </Button>
      </div>
    </form>
  );
}

export default function TradeFairsPage() {
  const [fairs, setFairs] = useState<TradeFair[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TradeFair | null>(null);

  async function load() {
    const [fairsRes, teamsRes] = await Promise.all([
      fetch("/api/v1/trade-fairs"),
      fetch("/api/v1/teams"),
    ]);
    if (fairsRes.ok) {
      const d = await fairsRes.json();
      setFairs(d.data ?? []);
    }
    if (teamsRes.ok) {
      const d = await teamsRes.json();
      setTeams(d.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this trade fair?")) return;
    await fetch(`/api/v1/trade-fairs/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Trade Fairs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage trade fairs and link leads / deals to them.
          </p>
        </div>
        {!showForm && !editing && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Trade Fair
          </Button>
        )}
      </div>

      {showForm && (
        <TradeFairForm
          teams={teams}
          onSave={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {editing && (
        <TradeFairForm
          fair={editing}
          teams={teams}
          onSave={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {fairs.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-muted-foreground">
          <Store className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No trade fairs yet.</p>
          <Button variant="link" size="sm" onClick={() => setShowForm(true)} className="mt-2">
            Add the first trade fair
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {fairs.map((fair) => (
            <div
              key={fair.id}
              className="rounded-lg border border-border bg-card p-4 flex items-start gap-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Store className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium truncate">{fair.name}</h3>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditing(fair)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(fair.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                  {(fair.location || fair.country) && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {[fair.location, fair.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                  {(fair.startDate || fair.endDate) && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {fair.startDate ?? ""}
                      {fair.startDate && fair.endDate ? " – " : ""}
                      {fair.endDate ?? ""}
                    </span>
                  )}
                  {fair.teamName && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {fair.teamName}
                    </span>
                  )}
                </div>
                {fair.description && (
                  <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                    {fair.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
