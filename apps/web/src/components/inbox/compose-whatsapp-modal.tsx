"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Ausgelagert aus app/(dashboard)/inbox/page.tsx (Plan 10, Entscheidung 8), Inhalt
// unverändert. Die alte Inbox und die neue Inbox öffnen dasselbe Fenster.

export type ChannelType = "email" | "whatsapp";

export interface ChannelAccount {
  id: string;
  name: string;
  address: string;
  channelType: ChannelType;
  operatingCompanyRecordId: string | null;
  isActive: boolean;
  // WhatsApp transport discriminator. waPhoneNumberId set ⇒ WABA Cloud API
  // (template-only compose). null ⇒ Baileys personal WhatsApp (free-text
  // compose), with baileysBridgeProvider selecting which bridge handles it.
  waPhoneNumberId?: string | null;
  baileysBridgeProvider?: string | null;
}


// ─── Compose WhatsApp modal ───────────────────────────────────────────────────
// First-contact flow: pick a business number, enter recipient phone + name.
//
// The sender's transport decides the rest:
//   • WABA Cloud API (waPhoneNumberId set) — Meta only allows outbound-initiated
//     conversations via approved templates, so the composer makes you pick a
//     template and fill its `{{n}}` variables.
//   • Baileys personal WhatsApp (waPhoneNumberId null) — no template requirement
//     and no 24h window, so the composer offers a plain free-text box instead.

interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<{ type: string; text?: string; format?: string }>;
  bodyVariableCount: number;
}

export function ComposeWhatsAppModal({
  accounts,
  onClose,
  onSent,
  initialChannelAccountId,
  initialPhone,
  initialCustomerName,
  initialMessage,
  dealRecordId,
}: {
  accounts: ChannelAccount[];
  onClose: () => void;
  onSent: (conversationId: string) => void;
  initialChannelAccountId?: string;
  initialPhone?: string;
  initialCustomerName?: string;
  /** Vorbereiteter Freitext (nur persönliches WhatsApp); gesendet wird erst mit dem Knopf. */
  initialMessage?: string;
  dealRecordId?: string | null;
}) {
  const [channelAccountId, setChannelAccountId] = useState<string>(
    initialChannelAccountId && accounts.some((a) => a.id === initialChannelAccountId)
      ? initialChannelAccountId
      : accounts[0]?.id ?? ""
  );
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [toPhone, setToPhone] = useState(initialPhone ?? "");
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");
  const [variables, setVariables] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Free-text body, used only by the Baileys (personal WhatsApp) branch.
  const [messageText, setMessageText] = useState(initialMessage ?? "");

  // Transport of the selected sender. Baileys accounts have no
  // waPhoneNumberId; only the in-house bridge can send outbound from the CRM.
  const selectedAccount = accounts.find((a) => a.id === channelAccountId) ?? null;
  const isBaileys = !!selectedAccount && !selectedAccount.waPhoneNumberId;
  const baileysOutboundSupported =
    isBaileys && selectedAccount?.baileysBridgeProvider === "inhouse";

  // Metadata: per-template variable labels. Keyed by `${name}|${language}`.
  type MetadataRow = {
    templateName: string;
    languageCode: string;
    variableLabels: Record<string, string>;
    headerImageUrl: string | null;
  };
  const [metadata, setMetadata] = useState<MetadataRow[]>([]);
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState<string>("");

  // Fetch templates AND metadata whenever the channel account changes.
  // Baileys senders have no Meta templates, so skip the fetch entirely —
  // calling the templates endpoint for them only yields a "missing WABA id"
  // error. Their compose path is the free-text box below.
  useEffect(() => {
    if (!channelAccountId) return;
    setTemplatesError(null);
    setSelectedTemplate("");
    setVariables([]);
    setMetadata([]);
    setSendError(null);
    if (isBaileys) {
      setTemplates([]);
      setTemplatesLoading(false);
      return;
    }
    setTemplatesLoading(true);
    Promise.all([
      fetch(`/api/v1/inbox/channel-accounts/${channelAccountId}/templates`).then(
        async (res) => {
          const j = await res.json();
          if (!res.ok) throw new Error(j.error?.message ?? "Vorlagen konnten nicht geladen werden");
          return (j.data ?? []).filter(
            (t: WhatsAppTemplate) => t.status === "APPROVED"
          ) as WhatsAppTemplate[];
        }
      ),
      fetch(
        `/api/v1/inbox/channel-accounts/${channelAccountId}/templates/metadata`
      )
        .then(async (res) => {
          const j = await res.json();
          if (!res.ok) return [] as MetadataRow[];
          return (j.data ?? []) as MetadataRow[];
        })
        .catch(() => [] as MetadataRow[]),
    ])
      .then(([tpls, meta]) => {
        setTemplates(tpls);
        setMetadata(meta);
      })
      .catch((err) => setTemplatesError(err.message))
      .finally(() => setTemplatesLoading(false));
  }, [channelAccountId, isBaileys]);

  const activeMetadata = metadata.find(
    (m) =>
      m.templateName === selectedTemplate &&
      m.languageCode ===
        (templates.find((t) => t.name === selectedTemplate)?.language ?? "")
  );

  function labelFor(index: number): string {
    return activeMetadata?.variableLabels[String(index + 1)] ?? `{{${index + 1}}}`;
  }

  async function saveLabel(index: number, value: string) {
    const tpl = templates.find((t) => t.name === selectedTemplate);
    if (!tpl) return;
    const currentLabels = { ...(activeMetadata?.variableLabels ?? {}) };
    if (value.trim()) {
      currentLabels[String(index + 1)] = value.trim();
    } else {
      delete currentLabels[String(index + 1)];
    }
    // Optimistic update so the UI doesn't flicker.
    setMetadata((prev) => {
      const key = `${tpl.name}|${tpl.language}`;
      const others = prev.filter(
        (m) => `${m.templateName}|${m.languageCode}` !== key
      );
      const prior = prev.find(
        (m) => `${m.templateName}|${m.languageCode}` === key
      );
      return [
        ...others,
        {
          templateName: tpl.name,
          languageCode: tpl.language,
          variableLabels: currentLabels,
          headerImageUrl: prior?.headerImageUrl ?? null,
        },
      ];
    });
    try {
      await fetch(
        `/api/v1/inbox/channel-accounts/${channelAccountId}/templates/metadata`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateName: tpl.name,
            languageCode: tpl.language,
            variableLabels: currentLabels,
          }),
        }
      );
    } catch {
      // Silent — the optimistic state keeps working, the server just didn't
      // persist. Next modal open will reload from server anyway.
    }
  }

  async function saveHeaderImageUrl(value: string) {
    const tpl = templates.find((t) => t.name === selectedTemplate);
    if (!tpl) return;
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    setMetadata((prev) => {
      const key = `${tpl.name}|${tpl.language}`;
      const others = prev.filter(
        (m) => `${m.templateName}|${m.languageCode}` !== key
      );
      const prior = prev.find(
        (m) => `${m.templateName}|${m.languageCode}` === key
      );
      return [
        ...others,
        {
          templateName: tpl.name,
          languageCode: tpl.language,
          variableLabels: prior?.variableLabels ?? {},
          headerImageUrl: next,
        },
      ];
    });
    try {
      await fetch(
        `/api/v1/inbox/channel-accounts/${channelAccountId}/templates/metadata`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateName: tpl.name,
            languageCode: tpl.language,
            headerImageUrl: next,
          }),
        }
      );
    } catch {
      // Silent — reloads from server on next open.
    }
  }

  // Reset variable inputs when the selected template changes.
  useEffect(() => {
    const tpl = templates.find((t) => t.name === selectedTemplate);
    if (!tpl) {
      setVariables([]);
      return;
    }
    setVariables(Array.from({ length: tpl.bodyVariableCount }, () => ""));
  }, [selectedTemplate, templates]);

  const activeTemplate = templates.find((t) => t.name === selectedTemplate);
  const bodyText =
    activeTemplate?.components.find((c) => c.type === "BODY")?.text ?? "";
  const previewText = bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const idx = Number(n) - 1;
    return variables[idx] || `{{${n}}}`;
  });

  const headerComponent = activeTemplate?.components.find(
    (c) => c.type === "HEADER"
  );
  const headerFormat = headerComponent?.format?.toUpperCase();
  const requiresHeaderImage = headerFormat === "IMAGE";
  const headerImageUrl = activeMetadata?.headerImageUrl ?? "";

  const phoneIsValid = toPhone.trim().replace(/\D+/g, "").length >= 7;
  const canSend =
    !sending &&
    !!channelAccountId &&
    phoneIsValid &&
    (isBaileys
      ? baileysOutboundSupported && messageText.trim().length > 0
      : !!selectedTemplate &&
        variables.every((v) => v.trim().length > 0) &&
        (!requiresHeaderImage || headerImageUrl.trim().length > 0));

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
      if (isBaileys) {
        // Baileys: free-text first message via the in-house bridge.
        const res = await fetch("/api/v1/inbox/whatsapp/send-baileys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelAccountId,
            toPhone,
            customerName,
            body: messageText,
            dealRecordId: dealRecordId ?? null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Senden fehlgeschlagen");
        onSent(j.data.conversationId);
        return;
      }

      // WABA Cloud API: open the conversation with an approved template.
      const tpl = templates.find((t) => t.name === selectedTemplate);
      const res = await fetch("/api/v1/inbox/whatsapp/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelAccountId,
          toPhone,
          customerName,
          templateName: selectedTemplate,
          languageCode: tpl?.language ?? "de",
          bodyParams: variables,
          dealRecordId: dealRecordId ?? null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Senden fehlgeschlagen");
      onSent(j.data.conversationId);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Senden fehlgeschlagen");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm">Neue WhatsApp-Nachricht</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine aktiven WhatsApp-Nummern konfiguriert. Bitte in den Einstellungen
              unter <b>Einstellungen → WhatsApp</b> eine Nummer hinzufügen.
            </p>
          ) : (
            <>
              {/* From (channel account) */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Absender</label>
                <select
                  value={channelAccountId}
                  onChange={(e) => setChannelAccountId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.address}
                    </option>
                  ))}
                </select>
              </div>

              {/* Recipient */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Empfänger (Telefon)</label>
                  <input
                    type="tel"
                    placeholder="+49 170 1234567"
                    value={toPhone}
                    onChange={(e) => setToPhone(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Kundenname</label>
                  <input
                    type="text"
                    placeholder="Max Mustermann"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Baileys (personal WhatsApp): free-text first message.
                  No template, no 24h window — just type and send. */}
              {isBaileys &&
                (baileysOutboundSupported ? (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Nachricht</label>
                    <textarea
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      rows={5}
                      placeholder="Nachricht eingeben…"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Persönliches WhatsApp: freie Textnachricht, keine Vorlage
                      nötig.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    Diese Nummer ist über den OpenClaw-Bridge verbunden, der kein
                    Senden aus dem CRM unterstützt. Stelle das Konto in den
                    Integrationen auf den hauseigenen Bridge um, um von hier zu
                    schreiben.
                  </p>
                ))}

              {/* Template picker — WABA Cloud API only */}
              {!isBaileys && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Vorlage</label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vorlagen werden geladen…
                  </div>
                ) : templatesError ? (
                  <p className="text-xs text-red-600">{templatesError}</p>
                ) : templates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Keine genehmigten Vorlagen für diese Nummer gefunden.
                  </p>
                ) : (
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Vorlage wählen</option>
                    {templates.map((t) => (
                      <option key={`${t.name}-${t.language}`} value={t.name}>
                        {t.name} ({t.language}, {t.category.toLowerCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              )}

              {/* Header image URL — required when the template has an IMAGE header */}
              {activeTemplate && requiresHeaderImage && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">
                    Header-Bild URL
                    <span className="text-muted-foreground font-normal ml-1">
                      (öffentlich erreichbar, einmal pro Vorlage gespeichert)
                    </span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://…/kottke-whatsapp-header.jpg"
                    defaultValue={headerImageUrl}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== headerImageUrl) {
                        void saveHeaderImageUrl(e.target.value);
                      }
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  {headerImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={headerImageUrl}
                      alt="Header preview"
                      className="mt-2 max-h-32 rounded border border-border"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <p className="text-[11px] text-amber-600">
                      Diese Vorlage hat ein Header-Bild. Ohne URL lehnt
                      Meta den Versand ab (#132012).
                    </p>
                  )}
                </div>
              )}

              {/* Variable inputs */}
              {activeTemplate && variables.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium">Variablen</label>
                  {variables.map((v, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {editingLabel === i ? (
                          <input
                            autoFocus
                            type="text"
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            onBlur={() => {
                              void saveLabel(i, labelDraft);
                              setEditingLabel(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              } else if (e.key === "Escape") {
                                setEditingLabel(null);
                              }
                            }}
                            placeholder={`Label für {{${i + 1}}}`}
                            className="flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs"
                          />
                        ) : (
                          <>
                            <span className="font-mono text-[10px] text-muted-foreground/70">
                              {`{{${i + 1}}}`}
                            </span>
                            <span className="font-medium text-foreground">
                              {activeMetadata?.variableLabels[String(i + 1)] ?? ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setLabelDraft(
                                  activeMetadata?.variableLabels[String(i + 1)] ?? ""
                                );
                                setEditingLabel(i);
                              }}
                              className="text-muted-foreground/60 hover:text-foreground"
                              title="Label bearbeiten"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                      <input
                        type="text"
                        value={v}
                        placeholder={labelFor(i)}
                        onChange={(e) =>
                          setVariables((prev) =>
                            prev.map((pv, pi) => (pi === i ? e.target.value : pv))
                          )
                        }
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Preview */}
              {activeTemplate && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Vorschau</label>
                  <div className="rounded-md bg-muted/40 border border-border p-3 text-sm whitespace-pre-wrap">
                    {previewText}
                  </div>
                </div>
              )}

              {sendError && <p className="text-xs text-red-600">{sendError}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSend} disabled={!canSend}>
            {sending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Senden
          </Button>
        </div>
      </div>
    </div>
  );
}
