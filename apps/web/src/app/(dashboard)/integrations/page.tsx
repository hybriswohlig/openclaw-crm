"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Plug,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  X,
  Eye,
  EyeOff,
  Upload,
  Zap,
  Link as LinkIcon,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationStatus = "coming_soon" | "active" | "inactive";
type IntegrationType = "built_in" | "zapier" | "custom";

interface Integration {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoSvg: string | null;
  logoUrl: string | null;
  type: IntegrationType;
  status: IntegrationStatus;
  apiKey?: string | null;
  webhookUrl: string | null;
  syncRules: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IntegrationStatus }) {
  if (status === "active")
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Aktiv
      </Badge>
    );
  if (status === "inactive")
    return (
      <Badge className="bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 gap-1">
        <XCircle className="h-3 w-3" />
        Inaktiv
      </Badge>
    );
  return (
    <Badge className="bg-muted text-muted-foreground border-border gap-1">
      <Clock className="h-3 w-3" />
      Coming soon
    </Badge>
  );
}

function TypeBadge({ type }: { type: IntegrationType }) {
  if (type === "zapier")
    return (
      <Badge variant="outline" className="gap-1 text-orange-500 border-orange-400/30">
        <Zap className="h-3 w-3" />
        Zapier
      </Badge>
    );
  if (type === "custom")
    return (
      <Badge variant="outline" className="gap-1 text-violet-500 border-violet-400/30">
        <LinkIcon className="h-3 w-3" />
        Custom
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Plug className="h-3 w-3" />
      Built-in
    </Badge>
  );
}

function IntegrationLogo({
  logoSvg,
  logoUrl,
  name,
  size = "md",
}: {
  logoSvg: string | null;
  logoUrl: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const text = size === "sm" ? "text-xs" : size === "lg" ? "text-lg" : "text-sm";

  if (logoSvg) {
    return (
      <div
        className={`${dim} rounded-xl flex items-center justify-center shrink-0 overflow-hidden bg-muted/40 p-1.5`}
        dangerouslySetInnerHTML={{ __html: logoSvg }}
      />
    );
  }
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={name} className={`${dim} rounded-xl object-contain`} />
    );
  }
  return (
    <div
      className={`${dim} rounded-xl flex items-center justify-center shrink-0 bg-muted text-muted-foreground font-semibold ${text}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Integration Card ─────────────────────────────────────────────────────────

function IntegrationCard({
  integration,
  isAdmin,
  onSelect,
}: {
  integration: Integration;
  isAdmin: boolean;
  onSelect: (i: Integration) => void;
}) {
  return (
    <button
      onClick={() => onSelect(integration)}
      className="group text-left rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <IntegrationLogo
          logoSvg={integration.logoSvg}
          logoUrl={integration.logoUrl}
          name={integration.name}
        />
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={integration.status} />
          <TypeBadge type={integration.type} />
        </div>
      </div>

      <div>
        <p className="font-semibold text-sm">{integration.name}</p>
        {integration.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {integration.description}
          </p>
        )}
      </div>

      <div className="flex items-center text-xs text-muted-foreground gap-1 mt-auto">
        {isAdmin ? (
          <>
            <Pencil className="h-3 w-3" />
            <span>Konfigurieren</span>
          </>
        ) : (
          <>
            <Eye className="h-3 w-3" />
            <span>Details anzeigen</span>
          </>
        )}
        <ChevronRight className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// ─── ImmobilienScout Sync Section ────────────────────────────────────────────

interface SyncResult {
  total: number;
  created: number;
  skipped: number;
  errors: string[];
}

function ImmoscoutSyncSection({ integration }: { integration: Integration }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMode, setSyncMode] = useState<"new" | "all" | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync(resetFirst: boolean) {
    setSyncing(true);
    setSyncMode(resetFirst ? "all" : "new");
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/v1/integrations/immoscout/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetFirst }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || data.error || "Sync fehlgeschlagen");
        return;
      }
      setResult(data.data);
    } catch {
      setError("Netzwerkfehler beim Synchronisieren");
    } finally {
      setSyncing(false);
      setSyncMode(null);
    }
  }

  const isReady = integration.status === "active" && integration.apiKey;

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Lead-Import (umzug-easy.de)
      </p>

      {!isReady ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          <p>Bitte aktiviere die Integration und hinterlege einen API-Key,</p>
          <p>um Leads von umzug-easy.de zu importieren.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => handleSync(false)}
              disabled={syncing}
              variant="outline"
              className="w-full"
            >
              {syncing && syncMode === "new" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Neue Leads
            </Button>
            <Button
              onClick={() => handleSync(true)}
              disabled={syncing}
              variant="default"
              className="w-full"
            >
              {syncing && syncMode === "all" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Alle Leads
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            <strong>Neue Leads</strong> importiert nur noch nicht abgerufene Anfragen.{" "}
            <strong>Alle Leads</strong> setzt den Status zurück und importiert alles erneut (Duplikate werden übersprungen).
          </p>

          {result && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="font-medium">Import abgeschlossen</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div className="text-center">
                  <p className="text-lg font-semibold text-foreground">{result.total}</p>
                  <p>Gesamt</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-emerald-600">{result.created}</p>
                  <p>Neu erstellt</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-muted-foreground">{result.skipped}</p>
                  <p>Übersprungen</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-destructive">
                    {result.errors.length} Fehler:
                  </p>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-destructive/80 break-all">{e}</p>
                  ))}
                  {result.errors.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      … und {result.errors.length - 5} weitere
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Detail / Edit Drawer ─────────────────────────────────────────────────────

function IntegrationDrawer({
  integration,
  isAdmin,
  onClose,
  onSaved,
  onDeleted,
}: {
  integration: Integration;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (updated: Integration) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    name: integration.name,
    description: integration.description ?? "",
    status: integration.status,
    apiKey: integration.apiKey ?? "",
    webhookUrl: integration.webhookUrl ?? "",
    syncRules: integration.syncRules ?? "",
  });

  // Reset form when drawer target changes
  useEffect(() => {
    setEditing(false);
    setShowKey(false);
    setConfirmDelete(false);
    setForm({
      name: integration.name,
      description: integration.description ?? "",
      status: integration.status,
      apiKey: integration.apiKey ?? "",
      webhookUrl: integration.webhookUrl ?? "",
      syncRules: integration.syncRules ?? "",
    });
  }, [integration.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || undefined,
          description: form.description || null,
          status: form.status,
          apiKey: form.apiKey || null,
          webhookUrl: form.webhookUrl || null,
          syncRules: form.syncRules || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onSaved(data.data);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/integrations/${integration.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onDeleted(integration.id);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  const syncRulesParsed = (() => {
    try {
      return integration.syncRules ? JSON.parse(integration.syncRules) : null;
    } catch {
      return integration.syncRules;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-background shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-4 shrink-0">
          <IntegrationLogo
            logoSvg={integration.logoSvg}
            logoUrl={integration.logoUrl}
            name={integration.name}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{integration.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusBadge status={integration.status} />
              <TypeBadge type={integration.type} />
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Description */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Beschreibung
            </p>
            {editing ? (
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {integration.description || "—"}
              </p>
            )}
          </div>

          {/* Status (admin only) */}
          {isAdmin && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Status
              </p>
              {editing ? (
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value as IntegrationStatus }))
                  }
                >
                  <option value="coming_soon">Coming soon</option>
                  <option value="active">Aktiv</option>
                  <option value="inactive">Inaktiv</option>
                </select>
              ) : (
                <StatusBadge status={integration.status} />
              )}
            </div>
          )}

          {/* API Key (admin only) */}
          {isAdmin && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                API Key
              </p>
              {editing ? (
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10 font-mono"
                    placeholder="sk-…"
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-muted-foreground">
                    {integration.apiKey
                      ? showKey
                        ? integration.apiKey
                        : "••••••••••••••••"
                      : "—"}
                  </span>
                  {integration.apiKey && (
                    <button
                      onClick={() => setShowKey((v) => !v)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Webhook / Zapier URL */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {integration.type === "zapier" ? "Zapier Webhook URL" : "Webhook URL"}
            </p>
            {isAdmin && editing ? (
              <input
                type="url"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="https://hooks.zapier.com/…"
                value={form.webhookUrl}
                onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
              />
            ) : (
              <p className="text-sm font-mono text-muted-foreground break-all">
                {integration.webhookUrl || "—"}
              </p>
            )}
          </div>

          {/* Sync Rules */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Sync-Regeln
            </p>
            {isAdmin && editing ? (
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[120px] resize-none"
                placeholder={'{\n  "syncDeals": true,\n  "syncContacts": false\n}'}
                value={form.syncRules}
                onChange={(e) => setForm((f) => ({ ...f, syncRules: e.target.value }))}
                spellCheck={false}
              />
            ) : (
              <pre className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 overflow-auto max-h-40">
                {syncRulesParsed
                  ? typeof syncRulesParsed === "object"
                    ? JSON.stringify(syncRulesParsed, null, 2)
                    : syncRulesParsed
                  : "—"}
              </pre>
            )}
          </div>

          {/* ImmobilienScout Sync */}
          {isAdmin && integration.slug === "immobilienscout24" && (
            <ImmoscoutSyncSection integration={integration} />
          )}

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-0.5 border-t border-border pt-4">
            <p>Erstellt: {new Date(integration.createdAt).toLocaleDateString("de-DE")}</p>
            <p>Geändert: {new Date(integration.updatedAt).toLocaleDateString("de-DE")}</p>
            <p>Typ: {integration.type}</p>
          </div>
        </div>

        {/* Footer */}
        {isAdmin && (
          <div className="border-t border-border px-6 py-4 flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setEditing(false)} className="mr-auto">
                  Abbrechen
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Speichern
                </Button>
              </>
            ) : (
              <>
                {integration.type === "custom" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive mr-auto"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Löschen
                  </Button>
                )}
                <Button onClick={() => setEditing(true)} className="ml-auto">
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Bearbeiten
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Integration löschen?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{integration.name}</strong> wird dauerhaft entfernt. Diese Aktion kann
            nicht rückgängig gemacht werden.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Add / New Integration Modal ──────────────────────────────────────────────

function AddIntegrationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (i: Integration) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    type: "custom" as IntegrationType,
    logoSvg: "",
    logoUrl: "",
    apiKey: "",
    webhookUrl: "",
  });

  function reset() {
    setForm({ name: "", slug: "", description: "", type: "custom", logoSvg: "", logoUrl: "", apiKey: "", webhookUrl: "" });
    setLogoPreview(null);
  }

  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
    setForm((f) => ({ ...f, name, slug }));
  }

  function handleLogoFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (file.type === "image/svg+xml") {
        setForm((f) => ({ ...f, logoSvg: content, logoUrl: "" }));
        setLogoPreview(content);
      } else {
        // For PNG/JPG use a data URL as logoUrl
        setForm((f) => ({ ...f, logoUrl: content, logoSvg: "" }));
        setLogoPreview(null);
      }
    };
    if (file.type === "image/svg+xml") {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  }

  async function handleSubmit() {
    if (!form.name || !form.slug) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
          type: form.type,
          logoSvg: form.logoSvg || undefined,
          logoUrl: form.logoUrl || undefined,
          apiKey: form.apiKey || undefined,
          webhookUrl: form.webhookUrl || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onCreated(data.data);
        reset();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neue Integration hinzufügen</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Logo upload */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Logo (SVG, PNG, JPG)</label>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl border border-border flex items-center justify-center bg-muted/40 overflow-hidden shrink-0">
                {form.logoSvg ? (
                  <div className="h-full w-full p-1.5" dangerouslySetInnerHTML={{ __html: form.logoSvg }} />
                ) : form.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <Upload className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1 flex-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  Datei wählen
                </Button>
                <p className="text-xs text-muted-foreground">oder URL eingeben</p>
                <input
                  type="url"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                  placeholder="https://..."
                  value={form.logoUrl}
                  onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value, logoSvg: "" }))}
                />
              </div>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="z.B. Slack"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>

          {/* Slug */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Slug (auto)</label>
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Typ</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as IntegrationType }))}
            >
              <option value="custom">Custom (API Key)</option>
              <option value="zapier">Zapier Webhook</option>
              <option value="built_in">Built-in</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Beschreibung</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[70px] resize-none"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Credentials */}
          {form.type !== "zapier" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
              <input
                type="password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="sk-…"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </div>
          )}

          {(form.type === "zapier" || form.type === "custom") && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {form.type === "zapier" ? "Zapier Webhook URL" : "Webhook URL"}
              </label>
              <input
                type="url"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="https://hooks.zapier.com/…"
                value={form.webhookUrl}
                onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Logo Edit Modal (for built-ins) ─────────────────────────────────────────

function LogoEditModal({
  integration,
  open,
  onClose,
  onSaved,
}: {
  integration: Integration;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: Integration) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoSvg, setLogoSvg] = useState(integration.logoSvg ?? "");
  const [logoUrl, setLogoUrl] = useState(integration.logoUrl ?? "");
  const [saving, setSaving] = useState(false);

  function handleFile(file: File) {
    const reader = new FileReader();
    if (file.type === "image/svg+xml") {
      reader.onload = (e) => { setLogoSvg(e.target?.result as string); setLogoUrl(""); };
      reader.readAsText(file);
    } else {
      reader.onload = (e) => { setLogoUrl(e.target?.result as string); setLogoSvg(""); };
      reader.readAsDataURL(file);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoSvg: logoSvg || null,
          logoUrl: logoUrl || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onSaved(data.data);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Logo ändern — {integration.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-xl border border-border bg-muted/40 flex items-center justify-center overflow-hidden">
              {logoSvg ? (
                <div className="h-full w-full p-2" dangerouslySetInnerHTML={{ __html: logoSvg }} />
              ) : logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xl font-bold text-muted-foreground">
                  {integration.name.charAt(0)}
                </span>
              )}
            </div>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".svg,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Datei hochladen (SVG, PNG, JPG)
            </Button>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Oder URL</label>
            <input
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://..."
              value={logoUrl}
              onChange={(e) => { setLogoUrl(e.target.value); setLogoSvg(""); }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Oder SVG-Code einfügen</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono min-h-[80px] resize-none"
              placeholder="<svg>...</svg>"
              value={logoSvg}
              onChange={(e) => { setLogoSvg(e.target.value); setLogoUrl(""); }}
              spellCheck={false}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Channel Accounts Section ─────────────────────────────────────────────────

interface ChannelAccount {
  id: string;
  name: string;
  address: string;
  channelType: "email" | "whatsapp";
  operatingCompanyRecordId: string | null;
  isActive: boolean;
  imapHost: string | null;
  smtpHost: string | null;
  wabaId: string | null;
  waPhoneNumberId: string | null;
  lastSyncAt: string | null;
}

interface OperatingCompany {
  id: string;
  name: string;
}

function ChannelAccountsSection({ isAdmin }: { isAdmin: boolean }) {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [companies, setCompanies] = useState<OperatingCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ChannelAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const emptyForm = {
    name: "", channelType: "email" as "email" | "whatsapp",
    address: "", credential: "", imapHost: "imap.gmail.com",
    smtpHost: "smtp.gmail.com", wabaId: "", waPhoneNumberId: "",
    operatingCompanyRecordId: "",
  };
  const [form, setForm] = useState(emptyForm);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsRes, companiesRes] = await Promise.all([
        fetch("/api/v1/inbox/channel-accounts"),
        fetch("/api/v1/operating-companies").catch(() => null),
      ]);
      if (accountsRes.ok) setAccounts(await accountsRes.json().then((d: { data: ChannelAccount[] }) => d.data ?? []));
      if (companiesRes?.ok) {
        const cj = await companiesRes.json();
        setCompanies(cj.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleSave() {
    setSaving(true);
    try {
      if (editTarget) {
        const patch: Record<string, unknown> = {
          name: form.name,
          imapHost: form.imapHost || null,
          smtpHost: form.smtpHost || null,
          wabaId: form.wabaId || null,
          waPhoneNumberId: form.waPhoneNumberId || null,
          operatingCompanyRecordId: form.operatingCompanyRecordId || null,
        };
        // Only send credential if the user typed a new one — otherwise
        // leave the existing value in the database untouched.
        if (form.credential) patch.credential = form.credential;
        await fetch(`/api/v1/inbox/channel-accounts/${editTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } else {
        await fetch("/api/v1/inbox/channel-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            operatingCompanyRecordId: form.operatingCompanyRecordId || undefined,
          }),
        });
      }
      await fetchAccounts();
      setAddOpen(false);
      setEditTarget(null);
      setForm(emptyForm);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Kanal-Account löschen?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/v1/inbox/channel-accounts/${id}`, { method: "DELETE" });
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  function openEdit(acc: ChannelAccount) {
    setForm({
      name: acc.name, channelType: acc.channelType, address: acc.address,
      credential: "", imapHost: acc.imapHost ?? "imap.gmail.com",
      smtpHost: acc.smtpHost ?? "smtp.gmail.com",
      wabaId: acc.wabaId ?? "", waPhoneNumberId: acc.waPhoneNumberId ?? "",
      operatingCompanyRecordId: acc.operatingCompanyRecordId ?? "",
    });
    setEditTarget(acc);
    setAddOpen(true);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Kanal-Accounts (Inbox)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            E-Mail- und WhatsApp-Konten, die im Posteingang empfangen und senden.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => { setForm(emptyForm); setEditTarget(null); setAddOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Hinzufügen
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Noch keine Kanal-Accounts konfiguriert.
          {isAdmin && (
            <button onClick={() => { setForm(emptyForm); setEditTarget(null); setAddOpen(true); }} className="block mx-auto mt-2 text-primary hover:underline text-xs">
              Ersten Account hinzufügen
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Adresse</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Typ</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Gesellschaft</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Letzter Sync</th>
                {isAdmin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr key={acc.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{acc.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{acc.address}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium
                      ${acc.channelType === "email" ? "text-blue-600 bg-blue-500/10 border-blue-400/20" : "text-emerald-600 bg-emerald-500/10 border-emerald-400/20"}`}>
                      {acc.channelType === "email" ? "E-Mail" : "WhatsApp"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {acc.operatingCompanyRecordId
                      ? companies.find((c) => c.id === acc.operatingCompanyRecordId)?.name ?? "—"
                      : <span className="text-amber-500">nicht verknüpft</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString("de-DE") : "Noch nicht synchronisiert"}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(acc)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDelete(acc.id)} disabled={deleting === acc.id} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors">
                          {deleting === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      <Dialog open={addOpen} onOpenChange={(v) => { if (!v) { setAddOpen(false); setEditTarget(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Kanal-Account bearbeiten" : "Kanal-Account hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
              <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="z.B. Kottke E-Mail" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            {!editTarget && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Typ</label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.channelType}
                    onChange={(e) => setForm((f) => ({ ...f, channelType: e.target.value as "email" | "whatsapp" }))}>
                    <option value="email">E-Mail (IMAP/SMTP)</option>
                    <option value="whatsapp">WhatsApp Business</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {form.channelType === "email" ? "E-Mail-Adresse *" : "Telefonnummer (E.164) *"}
                  </label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder={form.channelType === "email" ? "name@gmail.com" : "+49176..."}
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {form.channelType === "email" ? "Gmail App-Passwort" : "API Bearer Token"}
              </label>
              <input type="password" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder={editTarget ? "Leer lassen um nicht zu ändern" : ""}
                value={form.credential}
                onChange={(e) => setForm((f) => ({ ...f, credential: e.target.value }))} />
            </div>
            {form.channelType === "email" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">IMAP-Server</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.imapHost}
                    onChange={(e) => setForm((f) => ({ ...f, imapHost: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">SMTP-Server</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.smtpHost}
                    onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))} />
                </div>
              </div>
            )}
            {form.channelType === "whatsapp" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">WABA ID</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.wabaId}
                    onChange={(e) => setForm((f) => ({ ...f, wabaId: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Phone Number ID</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.waPhoneNumberId}
                    onChange={(e) => setForm((f) => ({ ...f, waPhoneNumberId: e.target.value }))} />
                </div>
              </div>
            )}
            {companies.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Betriebsgesellschaft</label>
                <select
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  value={form.operatingCompanyRecordId}
                  onChange={(e) => setForm((f) => ({ ...f, operatingCompanyRecordId: e.target.value }))}
                >
                  <option value="">— nicht verknüpft —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Eingehende Anfragen über diesen Kanal werden automatisch der gewählten Gesellschaft zugeordnet.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setEditTarget(null); }}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || (!editTarget && !form.address)}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editTarget ? "Speichern" : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [integrationsList, setIntegrationsList] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selected, setSelected] = useState<Integration | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [logoEditTarget, setLogoEditTarget] = useState<Integration | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [intRes, wsRes] = await Promise.all([
        fetch("/api/v1/integrations"),
        fetch("/api/v1/workspace"),
      ]);
      if (intRes.ok) {
        const data = await intRes.json();
        setIntegrationsList(data.data ?? []);
      }
      if (wsRes.ok) {
        const data = await wsRes.json();
        setIsAdmin(data.data?.role === "admin");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function handleSaved(updated: Integration) {
    setIntegrationsList((prev) =>
      prev.map((i) => (i.id === updated.id ? updated : i))
    );
    setSelected(updated);
  }

  function handleDeleted(id: string) {
    setIntegrationsList((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
  }

  function handleCreated(integration: Integration) {
    setIntegrationsList((prev) => [...prev, integration]);
  }

  const activeCount = integrationsList.filter((i) => i.status === "active").length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Integrationen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading
              ? "Wird geladen…"
              : `${integrationsList.length} Integration${integrationsList.length !== 1 ? "en" : ""} · ${activeCount} aktiv`}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Integration hinzufügen
          </Button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Coming-soon notice for non-admins when everything is coming soon */}
          {!isAdmin && integrationsList.every((i) => i.status === "coming_soon") && (
            <div className="rounded-xl border border-border bg-muted/30 p-8 text-center space-y-2">
              <Plug className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="font-medium">Integrationen kommen bald</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Die Integrationen werden gerade konfiguriert. Sobald sie aktiviert sind, erscheinen sie hier.
              </p>
            </div>
          )}

          {/* Grid */}
          {integrationsList.length > 0 && !(
            !isAdmin && integrationsList.every((i) => i.status === "coming_soon")
          ) && (
            <>
              {/* Active / Inactive */}
              {(isAdmin
                ? integrationsList
                : integrationsList.filter((i) => i.status !== "coming_soon")
              ).length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Konfiguriert
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {integrationsList
                      .filter((i) =>
                        isAdmin ? i.status !== "coming_soon" : i.status === "active"
                      )
                      .map((i) => (
                        <div key={i.id} className="relative">
                          <IntegrationCard integration={i} isAdmin={isAdmin} onSelect={setSelected} />
                          {isAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setLogoEditTarget(i); }}
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
                              title="Logo ändern"
                            >
                              <Upload className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </section>
              )}

              {/* Coming soon (always visible to admin, hidden from members) */}
              {isAdmin && integrationsList.some((i) => i.status === "coming_soon") && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Coming soon
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {integrationsList
                      .filter((i) => i.status === "coming_soon")
                      .map((i) => (
                        <div key={i.id} className="relative">
                          <IntegrationCard integration={i} isAdmin={isAdmin} onSelect={setSelected} />
                          {isAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setLogoEditTarget(i); }}
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
                              title="Logo ändern"
                            >
                              <Upload className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {/* Detail drawer */}
      {selected && (
        <IntegrationDrawer
          integration={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      {/* Add modal */}
      <AddIntegrationModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
      />

      {/* Logo edit modal */}
      {logoEditTarget && (
        <LogoEditModal
          integration={logoEditTarget}
          open={!!logoEditTarget}
          onClose={() => setLogoEditTarget(null)}
          onSaved={(updated) => {
            handleSaved(updated);
            if (selected?.id === updated.id) setSelected(updated);
          }}
        />
      )}

      {/* Channel accounts */}
      {!loading && (
        <div className="border-t border-border pt-6">
          <ChannelAccountsSection isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
}
