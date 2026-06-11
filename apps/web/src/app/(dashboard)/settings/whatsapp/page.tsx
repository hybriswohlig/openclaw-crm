"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2, CheckCircle2, XCircle, Copy } from "lucide-react";

interface ChannelAccount {
  id: string;
  name: string;
  channelType: "email" | "whatsapp";
  address: string;
  wabaId: string | null;
  waPhoneNumberId: string | null;
  waDisplayPhoneNumber: string | null;
  isActive: boolean;
  operatingCompanyRecordId: string | null;
}

interface OperatingCompany {
  id: string;
  name: string;
}

export default function WhatsAppSettingsPage() {
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [hasVerifyToken, setHasVerifyToken] = useState(false);
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [savingApp, setSavingApp] = useState(false);
  const [appSaved, setAppSaved] = useState<"ok" | "err" | null>(null);

  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [companies, setCompanies] = useState<OperatingCompany[]>([]);
  const [loading, setLoading] = useState(true);

  // New-account form
  const [formName, setFormName] = useState("");
  const [formDisplayPhone, setFormDisplayPhone] = useState("");
  const [formPhoneNumberId, setFormPhoneNumberId] = useState("");
  const [formWabaId, setFormWabaId] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formOpCompany, setFormOpCompany] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [settingsRes, accountsRes, companiesRes] = await Promise.all([
        fetch("/api/v1/settings/whatsapp"),
        fetch("/api/v1/inbox/channel-accounts"),
        fetch("/api/v1/operating-companies").catch(() => null),
      ]);
      const settings = await settingsRes.json();
      if (settings.data) {
        setHasAppSecret(settings.data.hasAppSecret);
        setHasVerifyToken(settings.data.hasVerifyToken);
      }
      const accountsJson = await accountsRes.json();
      const all: ChannelAccount[] = accountsJson.data ?? [];
      setAccounts(all.filter((a) => a.channelType === "whatsapp"));

      if (companiesRes) {
        const cj = await companiesRes.json();
        setCompanies(cj.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveAppSettings() {
    if (!appSecret && !verifyToken) return;
    setSavingApp(true);
    setAppSaved(null);
    try {
      const body: Record<string, string> = {};
      if (appSecret) body.appSecret = appSecret;
      if (verifyToken) body.verifyToken = verifyToken;
      const res = await fetch("/api/v1/settings/whatsapp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAppSaved("ok");
        setAppSecret("");
        setVerifyToken("");
        void loadAll();
      } else {
        setAppSaved("err");
      }
    } catch {
      setAppSaved("err");
    } finally {
      setSavingApp(false);
      setTimeout(() => setAppSaved(null), 2500);
    }
  }

  async function createAccount() {
    setCreateError(null);
    if (!formName || !formDisplayPhone || !formPhoneNumberId || !formToken) {
      setCreateError("Name, Anzeigenummer, Phone Number ID und Token sind erforderlich.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1/inbox/channel-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          channelType: "whatsapp",
          address: formDisplayPhone,
          credential: formToken,
          waDisplayPhoneNumber: formDisplayPhone,
          waPhoneNumberId: formPhoneNumberId,
          wabaId: formWabaId || undefined,
          operatingCompanyRecordId: formOpCompany || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setCreateError(j.error ?? "Nummer konnte nicht hinzugefügt werden");
        return;
      }
      setFormName("");
      setFormDisplayPhone("");
      setFormPhoneNumberId("");
      setFormWabaId("");
      setFormToken("");
      setFormOpCompany("");
      void loadAll();
    } finally {
      setCreating(false);
    }
  }

  async function deleteAccount(id: string) {
    if (!confirm("Diese WhatsApp-Nummer aus dem CRM entfernen?")) return;
    const res = await fetch(`/api/v1/inbox/channel-accounts/${id}`, { method: "DELETE" });
    if (res.ok) void loadAll();
  }

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "";

  function generateVerifyToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    setVerifyToken(token);
  }

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold">WhatsApp Business</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verbinde Meta-Cloud-API-Nummern, damit WhatsApp-Unterhaltungen im gemeinsamen
          Posteingang landen, zugeordnet zur jeweiligen Gesellschaft.
        </p>
      </div>

      {/* ─── Webhook + App credentials ─── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">1. Meta-App-Verbindung</h2>

        <div className="space-y-2">
          <Label>Webhook URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(webhookUrl)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Diese URL in der Meta App unter WhatsApp → Configuration → Callback URL eintragen.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="verifyToken">Verify-Token {hasVerifyToken && <span className="text-green-600 text-xs">(hinterlegt)</span>}</Label>
          <div className="flex gap-2">
            <Input
              id="verifyToken"
              placeholder={hasVerifyToken ? "••••••••••••••••" : "auf Generieren klicken oder einfügen"}
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
            />
            <Button variant="outline" size="sm" onClick={generateVerifyToken}>Generieren</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Denselben Wert hier und im Verify-Token-Feld bei Meta eintragen. Meta prüft damit
            beim Speichern unseren Webhook.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="appSecret">
            App-Secret {hasAppSecret && <span className="text-green-600 text-xs">(hinterlegt)</span>}
          </Label>
          <Input
            id="appSecret"
            type="password"
            placeholder={hasAppSecret ? "••••••••••••••••" : "Meta App → Settings → Basic → App Secret"}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Dient zur Prüfung des X-Hub-Signature-256-Headers bei jedem eingehenden Webhook.
            Wird verschlüsselt gespeichert.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={saveAppSettings}
            disabled={savingApp || (!appSecret && !verifyToken)}
          >
            {savingApp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Speichern
          </Button>
          {appSaved === "ok" && (
            <span className="text-sm text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Gespeichert
            </span>
          )}
          {appSaved === "err" && (
            <span className="text-sm text-red-600 flex items-center gap-1">
              <XCircle className="h-4 w-4" /> Fehlgeschlagen
            </span>
          )}
        </div>
      </section>

      {/* ─── Channel accounts (one per number) ─── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">2. WhatsApp-Nummern</h2>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine WhatsApp-Nummern. Füge unten eine hinzu.
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => {
              const linkedCompany = companies.find((c) => c.id === a.operatingCompanyRecordId);
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                >
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {a.waDisplayPhoneNumber ?? a.address} · id {a.waPhoneNumberId ?? "—"}
                    </div>
                    <div className="text-xs">
                      {linkedCompany ? (
                        <span className="text-muted-foreground">Gesellschaft: {linkedCompany.name}</span>
                      ) : (
                        <span className="text-amber-500">Keine Gesellschaft verknüpft</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {companies.length > 0 && (
                      <select
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                        value={a.operatingCompanyRecordId ?? ""}
                        onChange={async (e) => {
                          const val = e.target.value || null;
                          await fetch(`/api/v1/inbox/channel-accounts/${a.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ operatingCompanyRecordId: val }),
                          });
                          void loadAll();
                        }}
                      >
                        <option value="">keine</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => deleteAccount(a.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-md border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">WhatsApp-Nummer hinzufügen</h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="f-name">Bezeichnung</Label>
              <Input
                id="f-name"
                placeholder="z. B. Kottke Umzüge GmbH"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-phone">Anzeigenummer</Label>
              <Input
                id="f-phone"
                placeholder="+49 30 12345678"
                value={formDisplayPhone}
                onChange={(e) => setFormDisplayPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-pid">Phone Number ID</Label>
              <Input
                id="f-pid"
                placeholder="123456789012345"
                value={formPhoneNumberId}
                onChange={(e) => setFormPhoneNumberId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-waba">WABA ID</Label>
              <Input
                id="f-waba"
                placeholder="123456789012345"
                value={formWabaId}
                onChange={(e) => setFormWabaId(e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="f-token">System-User-Zugriffstoken</Label>
              <Input
                id="f-token"
                type="password"
                placeholder="EAAG..."
                value={formToken}
                onChange={(e) => setFormToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Im Meta Business Manager unter Business Settings → Users → System Users erstellen. Läuft nie ab, voller WABA-Zugriff.
              </p>
            </div>
            {companies.length > 0 && (
              <div className="col-span-2 space-y-1">
                <Label htmlFor="f-op">Gesellschaft</Label>
                <select
                  id="f-op"
                  value={formOpCompany}
                  onChange={(e) => setFormOpCompany(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">nicht verknüpft</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {createError && <p className="text-sm text-red-600">{createError}</p>}

          <div>
            <Button onClick={createAccount} disabled={creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Nummer hinzufügen
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
