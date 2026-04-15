"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, ArrowLeft, Save } from "lucide-react";

interface TaskRow {
  slug: string;
  label: string;
  description: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  enabled: boolean;
  dailySpendCapUsd: number | null;
  configured: boolean;
  last7d: {
    runs: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

type Draft = Partial<Omit<TaskRow, "slug" | "label" | "description" | "configured" | "last7d">>;

export default function AdminAITasksPage() {
  const router = useRouter();
  const [gate, setGate] = useState<"loading" | "ok" | "denied">("loading");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/admin/ai-tasks");
    if (res.status === 403) {
      setGate("denied");
      return;
    }
    if (res.ok) {
      const j = await res.json();
      setTasks(j.data.tasks ?? []);
      setDrafts({});
      setGate("ok");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (gate === "denied") router.replace("/home");
  }, [gate, router]);

  function setField<K extends keyof Draft>(slug: string, key: K, value: Draft[K]) {
    setDrafts((d) => ({ ...d, [slug]: { ...d[slug], [key]: value } }));
  }

  async function save(slug: string) {
    const draft = drafts[slug];
    if (!draft) return;
    setSaving(slug);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/ai-tasks/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        setMessage(`Saved ${slug}.`);
        await load();
      } else {
        const j = await res.json().catch(() => null);
        setMessage(j?.error?.message ?? "Save failed.");
      }
    } finally {
      setSaving(null);
    }
  }

  if (gate !== "ok") {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/home" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">AI tasks</h1>
          <p className="text-sm text-muted-foreground">
            Per-task model, fallback, spend cap, and 7-day usage. Changes take
            effect on the next AI call.
          </p>
        </div>
      </div>

      {message && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs">{message}</p>
      )}

      {tasks.map((t) => {
        const draft = drafts[t.slug] ?? {};
        const model = draft.model ?? t.model;
        const fallbackModel = draft.fallbackModel ?? t.fallbackModel ?? "";
        const dailyCap = draft.dailySpendCapUsd ?? t.dailySpendCapUsd;
        const enabled = draft.enabled ?? t.enabled;
        const dirty = Object.keys(draft).length > 0;
        return (
          <Card key={t.slug}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{t.label}</CardTitle>
                  <CardDescription className="mt-1">
                    <code className="text-xs">{t.slug}</code> — {t.description}
                  </CardDescription>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <div>{t.last7d.runs} runs / 7d</div>
                  <div>{t.last7d.failures} failed</div>
                  <div>
                    {t.last7d.inputTokens.toLocaleString()}→
                    {t.last7d.outputTokens.toLocaleString()} tok
                  </div>
                  <div>${t.last7d.costUsd.toFixed(4)}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Model</Label>
                  <Input
                    className="h-9 font-mono text-sm"
                    value={model}
                    onChange={(e) => setField(t.slug, "model", e.target.value)}
                    placeholder="openai/gpt-5.4-mini"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fallback model (optional)</Label>
                  <Input
                    className="h-9 font-mono text-sm"
                    value={fallbackModel}
                    onChange={(e) => setField(t.slug, "fallbackModel", e.target.value || null)}
                    placeholder="openai/gpt-5.4"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Daily spend cap (USD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="h-9 text-sm"
                    value={dailyCap ?? ""}
                    onChange={(e) =>
                      setField(
                        t.slug,
                        "dailySpendCapUsd",
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                    placeholder="unlimited"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm pt-6">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setField(t.slug, "enabled", e.target.checked)}
                  />
                  Enabled
                </label>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!dirty || saving === t.slug}
                  onClick={() => save(t.slug)}
                >
                  {saving === t.slug ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
