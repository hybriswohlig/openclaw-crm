"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface CompanySwitch {
  id: string;
  name: string;
  suggestionsEnabled: boolean;
  autoWriteEnabled: boolean;
}

interface Settings {
  suggestionsEnabled: boolean;
  autoWriteEnabled: boolean;
  confidenceThreshold: number;
  operatingCompanies: CompanySwitch[];
}

export default function DealEnrichmentSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/deal-enrichment")
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setSettings(json.data);
      })
      .catch(() => setError("Einstellungen konnten nicht geladen werden"));
  }, []);

  function patchCompany(id: string, patch: Partial<CompanySwitch>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            operatingCompanies: current.operatingCompanies.map((company) =>
              company.id === id ? { ...company, ...patch } : company
            ),
          }
        : current
    );
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/v1/settings/deal-enrichment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionsEnabled: settings.suggestionsEnabled,
          autoWriteEnabled: settings.autoWriteEnabled,
          confidenceThreshold: settings.confidenceThreshold,
          operatingCompanies: Object.fromEntries(
            settings.operatingCompanies.map((company) => [
              company.id,
              {
                suggestionsEnabled: company.suggestionsEnabled,
                autoWriteEnabled: company.autoWriteEnabled,
              },
            ])
          ),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message || "Speichern fehlgeschlagen");
        return;
      }
      setSettings(json.data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">KI-Felder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leere Quelle, Anzeige, Verlustgrund, die Phase und die Kontaktart aus dem Gespräch. Bewerbungen
          werden als Bewerber vorgeschlagen. Es wird nie eine Nachricht gesendet und nie ein gesetzter
          Wert überschrieben. Die Standard-Kontaktart Lead/Kunde gilt als leer und darf ersetzt werden.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.suggestionsEnabled}
          onChange={(event) => setSettings({ ...settings, suggestionsEnabled: event.target.checked })}
        />
        Vorschläge für den Workspace
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.autoWriteEnabled}
          onChange={(event) => setSettings({ ...settings, autoWriteEnabled: event.target.checked })}
        />
        Automatisch schreiben ab der Schwelle
      </label>
      <div className="space-y-1">
        <Label htmlFor="threshold">Sicherheitsschwelle (0–1)</Label>
        <Input
          id="threshold"
          type="number"
          min={0.5}
          max={1}
          step={0.01}
          value={settings.confidenceThreshold}
          onChange={(event) =>
            setSettings({ ...settings, confidenceThreshold: Number(event.target.value) })
          }
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Gesellschaften</h2>
        {settings.operatingCompanies.map((company) => (
          <div key={company.id} className="rounded-md border p-3">
            <div className="text-sm font-medium">{company.name}</div>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={company.suggestionsEnabled}
                  onChange={(event) => patchCompany(company.id, { suggestionsEnabled: event.target.checked })}
                />
                Vorschläge
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={company.autoWriteEnabled}
                  onChange={(event) => patchCompany(company.id, { autoWriteEnabled: event.target.checked })}
                />
                Automatisch schreiben
              </label>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {saved ? "Gespeichert" : "Speichern"}
      </Button>
    </div>
  );
}
