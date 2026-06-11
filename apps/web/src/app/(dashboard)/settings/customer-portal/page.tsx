"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OperatingCompanyCard } from "./_components/operating-company-card";
import type { OperatingCompanyPortalSettings } from "@/services/customer-portal-config";

interface ListResponse {
  operatingCompanies: OperatingCompanyPortalSettings[];
  vercelIntegrationAvailable: boolean;
}

export default function CustomerPortalSettingsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/customer-portal-settings");
      if (res.ok) {
        const json = (await res.json()) as { data: ListResponse };
        setData(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Kunden-Portal</h1>
        <p className="text-sm text-muted-foreground">
          Domain, Branding und Sichtbarkeit des Kunden-Status-Links pro Firma.
          Pro Firma kannst du eine eigene Subdomain hinterlegen
          (z.&nbsp;B. <code>status.kottke-umzuege.de</code>) und das Feature
          gezielt aktivieren oder ausschalten.
        </p>
      </header>

      {data && !data.vercelIntegrationAvailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-medium">Hinweis:</strong> Die Vercel-API ist
          nicht verbunden. Domains müssen aktuell manuell im Vercel-Dashboard
          unter <em>Project → Domains</em> ergänzt werden. Zum automatischen
          Hinzufügen die Umgebungsvariablen <code>VERCEL_API_TOKEN</code>,
          <code> VERCEL_PROJECT_ID</code> und <code>VERCEL_TEAM_ID</code> setzen
          und neu deployen.
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Lade Einstellungen…
        </div>
      )}

      {!loading && data && data.operatingCompanies.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Es sind noch keine Gesellschaften angelegt. Lege zuerst unter{" "}
          <a className="underline" href="/settings/operating-companies">
            Gesellschaften
          </a>{" "}
          eine Firma an.
        </div>
      )}

      <div className="space-y-4">
        {data?.operatingCompanies.map((oc) => (
          <OperatingCompanyCard
            key={oc.operatingCompanyRecordId}
            settings={oc}
            onChanged={load}
          />
        ))}
      </div>

      <PortalNotificationsCard />
    </div>
  );
}

/**
 * Workspace-wide master switch for automatic customer status messages
 * (WhatsApp-first, email fallback). Backed by
 * /api/v1/portal-notification-settings; default OFF.
 */
function PortalNotificationsCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/portal-notification-settings");
      if (res.ok) {
        const json = (await res.json()) as { data: { enabled: boolean } };
        if (!cancelled) setEnabled(json.data.enabled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (enabled === null || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/portal-notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data: { enabled: boolean } };
        setEnabled(json.data.enabled);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Automatische Status-Nachrichten</div>
            <div className="text-xs text-muted-foreground">
              Sendet dem Kunden automatisch eine WhatsApp-Nachricht (sonst
              E-Mail), wenn die Auftragsbestätigung fertig ist, die Anzahlung
              eingegangen ist, das Team losfährt und die Rechnung bereitsteht.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy || enabled === null}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
            enabled ? "bg-emerald-500" : "bg-muted"
          )}
          aria-pressed={enabled === true}
          aria-label="Automatische Status-Nachrichten umschalten"
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
    </div>
  );
}
