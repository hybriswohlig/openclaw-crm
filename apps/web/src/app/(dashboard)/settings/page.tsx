"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X } from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  settings: { logo?: string } | null;
  createdAt: string;
}

export default function SettingsPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/v1/workspace")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          setWorkspace(data.data);
          setName(data.data.name);
          setLogo(data.data.settings?.logo ?? null);
        }
      })
      .catch(() => {});
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".svg") && file.type !== "image/svg+xml") {
      alert("Please upload an SVG file.");
      return;
    }
    if (file.size > 50_000) {
      alert("SVG file must be under 50 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setLogo(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          settings: { ...workspace?.settings, logo: logo || undefined },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.data);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasChanges = name !== workspace.name || (logo ?? null) !== (workspace.settings?.logo ?? null);

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold mb-6">General Settings</h1>

      <div className="space-y-6">
        {/* Logo */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Organization logo</label>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-input bg-background overflow-hidden">
              {logo ? (
                <div
                  className="h-full w-full p-1 [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: logo }}
                />
              ) : (
                <span className="text-2xl font-semibold text-muted-foreground">
                  {(workspace.name || "O").charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Upload SVG
              </Button>
              {logo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLogo(null)}
                  className="text-muted-foreground"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".svg,image/svg+xml"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            SVG only, max 50 KB. Displayed in the sidebar.
          </p>
        </div>

        {/* Organization name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Organization name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Slug (read-only) */}
        <div className="space-y-2">
          <label className="text-sm font-medium">URL slug</label>
          <input
            type="text"
            value={workspace.slug}
            disabled
            className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground"
          />
          <p className="text-xs text-muted-foreground">
            The slug is used in URLs and cannot be changed.
          </p>
        </div>

        {/* Internal ID */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Internal ID</label>
          <input
            type="text"
            value={workspace.id}
            disabled
            className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground font-mono text-xs"
          />
        </div>

        {/* Created */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Created</label>
          <p className="text-sm text-muted-foreground">
            {new Date(workspace.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          {saved && <span className="text-sm text-green-500">Saved</span>}
        </div>
      </div>
    </div>
  );
}
