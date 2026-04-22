"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Save } from "lucide-react";

const MODELS = [
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { value: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { value: "openrouter/elephant-alpha", label: "Elephant Alpha" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "openai/gpt-5.4", label: "GPT-5.4" },
  { value: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
  { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { value: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nvidia Nemotron 3 Super 120B (free)" },
];

// ─── AI Task Config types ────────────────────────────────────────────────────

interface TaskConfig {
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
  hasOverride: boolean;
}

export default function AISettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testMessage, setTestMessage] = useState("");

  // ── AI Task Config state ─────────────────────────────────────────────────
  const [tasks, setTasks] = useState<TaskConfig[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [savingTask, setSavingTask] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/ai-task-configs");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.data ?? []);
      }
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/v1/ai-settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.data) {
          setModel(data.data.model);
          setHasApiKey(data.data.hasApiKey);
        }
      })
      .catch(() => {});
    fetchTasks();
  }, [fetchTasks]);

  function updateTask(slug: string, patch: Partial<TaskConfig>) {
    setTasks((prev) =>
      prev.map((t) => (t.slug === slug ? { ...t, ...patch } : t))
    );
  }

  async function saveTask(task: TaskConfig) {
    setSavingTask(task.slug);
    try {
      await fetch(`/api/v1/ai-task-configs/${task.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: task.enabled,
          model: task.model,
          fallbackModel: task.fallbackModel,
          temperature: task.temperature,
          maxTokens: task.maxTokens,
          dailySpendCapUsd: task.dailySpendCapUsd,
        }),
      });
    } finally {
      setSavingTask(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, string> = { model };
      if (apiKey) body.apiKey = apiKey;

      const res = await fetch("/api/v1/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setHasApiKey(data.data.hasApiKey);
        setApiKey("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestMessage("");
    try {
      const keyToTest = apiKey || undefined;
      const res = await fetch("/api/v1/ai-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyToTest, model }),
      });
      const data = await res.json();
      if (res.ok && data.data?.success) {
        setTestResult("success");
        setTestMessage("Connection successful");
      } else {
        setTestResult("error");
        setTestMessage(data.error?.message || data.data?.error || "Connection failed");
      }
    } catch {
      setTestResult("error");
      setTestMessage("Network error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">AI Agent</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the AI assistant that can answer questions about your CRM data and take actions on your behalf.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="apiKey">OpenRouter API Key</Label>
          <div className="relative">
            <Input
              id="apiKey"
              type={showKey ? "text" : "password"}
              placeholder={hasApiKey ? "••••••••••••••••" : "sk-or-v1-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {hasApiKey && !apiKey && (
            <p className="text-xs text-muted-foreground">API key is set. Enter a new key to replace it.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Get your API key from{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              openrouter.ai/keys
            </a>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || (!hasApiKey && !apiKey)}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Test Connection
          </Button>
          {testResult && (
            <span className={`flex items-center gap-1 text-sm ${testResult === "success" ? "text-green-600" : "text-red-600"}`}>
              {testResult === "success" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {testMessage}
            </span>
          )}
        </div>
      </div>

      {/* ── AI Tasks ──────────────────────────────────────────────────────── */}
      <div className="border-t pt-8">
        <div>
          <h2 className="text-lg font-semibold">AI Tasks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure individual AI features — enable/disable, choose models, and set daily spend caps.
          </p>
        </div>

        {loadingTasks ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">
            No AI tasks registered yet. Tasks appear here automatically when first used.
          </p>
        ) : (
          <div className="space-y-6 mt-4">
            {tasks.map((task) => (
              <div
                key={task.slug}
                className="rounded-lg border p-4 space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm">{task.label}</h3>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {task.slug}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {task.description}
                    </p>
                  </div>

                  {/* Enabled toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={task.enabled}
                    onClick={() => updateTask(task.slug, { enabled: !task.enabled })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      task.enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        task.enabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {task.enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Model</Label>
                      <select
                        value={task.model}
                        onChange={(e) => updateTask(task.slug, { model: e.target.value })}
                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {MODELS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        {/* Show current model even if not in the MODELS list */}
                        {!MODELS.some((m) => m.value === task.model) && (
                          <option value={task.model}>{task.model}</option>
                        )}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Fallback Model</Label>
                      <select
                        value={task.fallbackModel ?? ""}
                        onChange={(e) =>
                          updateTask(task.slug, {
                            fallbackModel: e.target.value || null,
                          })
                        }
                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">None</option>
                        {MODELS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        {task.fallbackModel && !MODELS.some((m) => m.value === task.fallbackModel) && (
                          <option value={task.fallbackModel}>{task.fallbackModel}</option>
                        )}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Daily Spend Cap (USD)</Label>
                      <Input
                        type="number"
                        step="0.50"
                        min="0"
                        value={task.dailySpendCapUsd ?? ""}
                        onChange={(e) =>
                          updateTask(task.slug, {
                            dailySpendCapUsd: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        placeholder="No limit"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Temperature</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={task.temperature ?? ""}
                        onChange={(e) =>
                          updateTask(task.slug, {
                            temperature: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        placeholder="Default"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveTask(task)}
                    disabled={savingTask === task.slug}
                    className="h-7 text-xs gap-1.5"
                  >
                    {savingTask === task.slug ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
