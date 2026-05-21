"use client";

import { useState } from "react";
import { Loader2, Globe, ChevronDown, Power, ShieldCheck, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatingCompanyPortalSettings } from "@/services/customer-portal-config";
import { EditPortalDialog } from "./edit-portal-dialog";
import { DomainStatusBlock } from "./domain-status-block";

/**
 * One collapsed/expanded card per operating company. The collapsed view shows
 * domain + status + enable toggle; the expanded view exposes the full
 * branding/payment editor.
 */
export function OperatingCompanyCard({
  settings,
  onChanged,
}: {
  settings: OperatingCompanyPortalSettings;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggleEnabled() {
    setBusy(true);
    try {
      await fetch(`/api/v1/customer-portal-settings/${settings.operatingCompanyRecordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !settings.enabled }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function verifyDomain() {
    setVerifying(true);
    try {
      await fetch(
        `/api/v1/customer-portal-settings/${settings.operatingCompanyRecordId}/verify-domain`,
        { method: "POST" }
      );
      onChanged();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          {settings.primaryColor ? (
            <span
              className="h-7 w-7 shrink-0 rounded-full"
              style={{ background: `#${settings.primaryColor}` }}
            />
          ) : (
            <span className="h-7 w-7 shrink-0 rounded-full bg-muted" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {settings.displayName || settings.operatingCompanyName}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {settings.customDomain ? (
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {settings.customDomain}
                </span>
              ) : (
                <span>Keine Domain konfiguriert</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StateBadge state={settings.domainVerificationState} enabled={settings.enabled} />
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border/50 px-4 py-4">
          {/* Enable toggle row */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background px-4 py-3">
            <div className="flex items-center gap-3">
              <Power className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Kunden-Status-Link aktiv</div>
                <div className="text-xs text-muted-foreground">
                  Wenn aus, wird auf neuen Leads dieser Firma kein Link erzeugt
                  und der Share-Bereich auf dem Lead-Detail bleibt deaktiviert.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleEnabled}
              disabled={busy}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
                settings.enabled ? "bg-emerald-500" : "bg-muted"
              )}
              aria-pressed={settings.enabled}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                  settings.enabled ? "translate-x-5" : "translate-x-0.5"
                )}
              />
            </button>
          </div>

          {/* Domain status */}
          <DomainStatusBlock settings={settings} onVerify={verifyDomain} verifying={verifying} />

          {/* Branding preview + edit */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">Branding & Zahldaten</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Name auf der Statusseite:{" "}
                <strong>{settings.displayName || settings.operatingCompanyName}</strong>
                {settings.bankIban ? (
                  <> · IBAN {maskIban(settings.bankIban)}</>
                ) : (
                  <> · keine IBAN hinterlegt</>
                )}
                {settings.paypalHandle ? <> · PayPal vorhanden</> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-9 shrink-0 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              Bearbeiten
            </button>
          </div>
        </div>
      )}

      <EditPortalDialog
        open={editing}
        onOpenChange={setEditing}
        settings={settings}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    </div>
  );
}

function StateBadge({
  state,
  enabled,
}: {
  state: OperatingCompanyPortalSettings["domainVerificationState"];
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Inaktiv
      </span>
    );
  }
  if (state === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <ShieldCheck className="h-3 w-3" />
        Verifiziert
      </span>
    );
  }
  if (state === "pending_dns" || state === "pending_ssl") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <Loader2 className="h-3 w-3 animate-spin" />
        {state === "pending_dns" ? "DNS prüfen" : "SSL prüfen"}
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-900 dark:bg-red-950/40 dark:text-red-200">
        <AlertCircle className="h-3 w-3" />
        Fehler
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      Nicht konfiguriert
    </span>
  );
}

function maskIban(iban: string): string {
  const c = iban.replace(/\s/g, "");
  if (c.length < 10) return iban;
  return `${c.slice(0, 4)} … ${c.slice(-4)}`;
}
