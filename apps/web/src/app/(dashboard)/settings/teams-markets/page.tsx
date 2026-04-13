"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, Pencil, Trash2, Globe, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const BUILT_IN_TEAMS = [
  { key: "ne_germany", name: "N&E Germany" },
  { key: "ne_france", name: "N&E France" },
  { key: "ne_uk", name: "N&E UK" },
  { key: "ne_singapore", name: "N&E Singapore" },
];

interface Team {
  id: string;
  key: string;
  name: string;
  responsiblePerson: string | null;
}

interface Market {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  responsiblePerson: string | null;
}

export default function TeamsMarketsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamPerson, setTeamPerson] = useState("");
  const [teamSaving, setTeamSaving] = useState(false);

  // Market form
  const [showMarketForm, setShowMarketForm] = useState(false);
  const [editingMarket, setEditingMarket] = useState<Market | null>(null);
  const [marketName, setMarketName] = useState("");
  const [marketTeamId, setMarketTeamId] = useState("");
  const [marketPerson, setMarketPerson] = useState("");
  const [marketSaving, setMarketSaving] = useState(false);

  const inputClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  async function load() {
    const [tr, mr] = await Promise.all([
      fetch("/api/v1/teams"),
      fetch("/api/v1/markets"),
    ]);
    if (tr.ok) setTeams((await tr.json()).data ?? []);
    if (mr.ok) setMarkets((await mr.json()).data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openEditTeam(team: Team) {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamPerson(team.responsiblePerson ?? "");
    setShowTeamForm(false);
  }

  function openEditMarket(market: Market) {
    setEditingMarket(market);
    setMarketName(market.name);
    setMarketTeamId(market.teamId ?? "");
    setMarketPerson(market.responsiblePerson ?? "");
    setShowMarketForm(false);
  }

  function resetTeamForm() {
    setTeamName(""); setTeamPerson(""); setEditingTeam(null); setShowTeamForm(false);
  }

  function resetMarketForm() {
    setMarketName(""); setMarketTeamId(""); setMarketPerson(""); setEditingMarket(null); setShowMarketForm(false);
  }

  async function saveTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setTeamSaving(true);
    const body = { name: teamName, responsiblePerson: teamPerson || null };
    if (editingTeam) {
      await fetch(`/api/v1/teams/${editingTeam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/v1/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, key: "custom" }),
      });
    }
    setTeamSaving(false);
    resetTeamForm();
    load();
  }

  async function deleteTeam(id: string) {
    if (!confirm("Delete this team?")) return;
    await fetch(`/api/v1/teams/${id}`, { method: "DELETE" });
    load();
  }

  async function saveMarket(e: React.FormEvent) {
    e.preventDefault();
    if (!marketName.trim()) return;
    setMarketSaving(true);
    const body = {
      name: marketName,
      teamId: marketTeamId || null,
      responsiblePerson: marketPerson || null,
    };
    if (editingMarket) {
      await fetch(`/api/v1/markets/${editingMarket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/v1/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setMarketSaving(false);
    resetMarketForm();
    load();
  }

  async function deleteMarket(id: string) {
    if (!confirm("Delete this market?")) return;
    await fetch(`/api/v1/markets/${id}`, { method: "DELETE" });
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
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-xl font-semibold">Teams &amp; Markets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure N&amp;E regional teams and the markets each team covers. Leads and deals can be
          filtered by team or market.
        </p>
      </div>

      {/* ── Teams ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            Teams
          </h2>
          {!showTeamForm && !editingTeam && (
            <Button size="sm" variant="outline" onClick={() => setShowTeamForm(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Team
            </Button>
          )}
        </div>

        {/* Built-in teams info */}
        <div className="rounded-md bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          The four N&amp;E regional teams are seeded automatically:&nbsp;
          {BUILT_IN_TEAMS.map((t) => t.name).join(", ")}.
        </div>

        {(showTeamForm || editingTeam) && (
          <form onSubmit={saveTeam} className="rounded-lg border border-border p-4 space-y-3 bg-card">
            <h3 className="text-sm font-medium">{editingTeam ? "Edit Team" : "New Team"}</h3>
            <div className="space-y-1">
              <label className="text-sm font-medium">Team Name *</label>
              <input className={inputClass} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. N&E DACH" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Responsible Person</label>
              <input className={inputClass} value={teamPerson} onChange={(e) => setTeamPerson(e.target.value)} placeholder="Name or email" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={resetTeamForm}>Cancel</Button>
              <Button type="submit" size="sm" disabled={teamSaving}>
                {teamSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingTeam ? "Save" : "Create"}
              </Button>
            </div>
          </form>
        )}

        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No teams yet. The built-in teams are created when the database is seeded.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{team.name}</p>
                  {team.responsiblePerson && (
                    <p className="text-xs text-muted-foreground">{team.responsiblePerson}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTeam(team)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteTeam(team.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Markets ────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Markets
          </h2>
          {!showMarketForm && !editingMarket && (
            <Button size="sm" variant="outline" onClick={() => setShowMarketForm(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Market
            </Button>
          )}
        </div>

        {(showMarketForm || editingMarket) && (
          <form onSubmit={saveMarket} className="rounded-lg border border-border p-4 space-y-3 bg-card">
            <h3 className="text-sm font-medium">{editingMarket ? "Edit Market" : "New Market"}</h3>
            <div className="space-y-1">
              <label className="text-sm font-medium">Market Name *</label>
              <input className={inputClass} value={marketName} onChange={(e) => setMarketName(e.target.value)} placeholder="e.g. Germany, DACH, Southeast Asia" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Assigned Team</label>
              <select className={inputClass} value={marketTeamId} onChange={(e) => setMarketTeamId(e.target.value)}>
                <option value="">— unassigned (covered by person) —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Responsible Person (if unassigned)</label>
              <input className={inputClass} value={marketPerson} onChange={(e) => setMarketPerson(e.target.value)} placeholder="Name or email" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={resetMarketForm}>Cancel</Button>
              <Button type="submit" size="sm" disabled={marketSaving}>
                {marketSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingMarket ? "Save" : "Create"}
              </Button>
            </div>
          </form>
        )}

        {markets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-muted-foreground">
            <Globe className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No markets defined yet.</p>
            <Button variant="link" size="sm" onClick={() => setShowMarketForm(true)} className="mt-1">
              Add the first market
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {markets.map((market) => (
              <div key={market.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{market.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {market.teamName
                      ? `Team: ${market.teamName}`
                      : market.responsiblePerson
                        ? `Person: ${market.responsiblePerson}`
                        : "Unassigned"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditMarket(market)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteMarket(market.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
