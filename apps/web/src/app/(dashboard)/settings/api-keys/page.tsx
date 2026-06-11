"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Copy, Check, AlertTriangle } from "lucide-react";

interface ApiKey {
  id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Key reveal dialog
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoke dialog
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function fetchKeys() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.data?.api_keys ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchKeys();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedKey(data.data.key);
        setNewName("");
        setShowCreate(false);
        fetchKeys();
      } else {
        const data = await res.json();
        setError(data.error?.message ?? "API-Schlüssel konnte nicht erstellt werden");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/v1/api-keys/${revokeTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== revokeTarget.id));
        setRevokeTarget(null);
      } else {
        const data = await res.json();
        setError(data.error?.message ?? "API-Schlüssel konnte nicht widerrufen werden");
      }
    } finally {
      setRevoking(false);
    }
  }

  function handleCopy() {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">API-Schlüssel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            API-Schlüssel für den programmatischen Zugriff verwalten. Die Schlüssel nutzen Bearer-Token-Authentifizierung.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Schlüssel erstellen
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          <button
            onClick={() => setError("")}
            className="ml-2 underline hover:no-underline"
          >
            schließen
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Schlüssel</th>
                <th className="px-4 py-3 text-left font-medium">Erstellt</th>
                <th className="px-4 py-3 text-left font-medium">Zuletzt verwendet</th>
                <th className="px-4 py-3 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{key.name}</span>
                    {key.expiresAt && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        Läuft ab am {new Date(key.expiresAt).toLocaleDateString("de-DE")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-2 py-1 text-xs">
                      {key.keyPrefix}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString("de-DE")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleDateString("de-DE")
                      : "Nie"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRevokeTarget(key)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {keys.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Noch keine API-Schlüssel. Erstelle einen, um loszulegen.
            </div>
          )}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API-Schlüssel erstellen</DialogTitle>
            <DialogDescription>
              Erstelle einen neuen API-Schlüssel für den programmatischen Zugriff auf das CRM.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  placeholder="z. B. Claude Agent, CI-Pipeline"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreate(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Erstellen
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Key reveal dialog */}
      <Dialog
        open={!!revealedKey}
        onOpenChange={() => {
          setRevealedKey(null);
          setCopied(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API-Schlüssel erstellt</DialogTitle>
            <DialogDescription>
              Kopiere diesen Schlüssel jetzt. Er wird danach nicht mehr angezeigt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
              <code className="flex-1 break-all text-sm">{revealedKey}</code>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className="h-8 w-8 shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" />
              <span>
                Bewahre diesen Schlüssel sicher auf. Er wird nicht erneut angezeigt. Verwendung
                als Bearer-Token: <code className="text-xs">Authorization: Bearer {"<key>"}</code>
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setRevealedKey(null);
                setCopied(false);
              }}
            >
              Fertig
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API-Schlüssel widerrufen</DialogTitle>
            <DialogDescription>
              Soll &quot;{revokeTarget?.name}&quot; wirklich widerrufen werden? Anwendungen,
              die diesen Schlüssel verwenden, verlieren sofort den Zugriff.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Schlüssel widerrufen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
