"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  HelpCircle,
  Scale,
  MessageSquare,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptMessage {
  id: string;
  conversationId: string;
  channelType: "email" | "whatsapp";
  channelName: string;
  channelAddress: string;
  direction: "inbound" | "outbound";
  fromAddress: string | null;
  contactName: string | null;
  subject: string | null;
  body: string;
  sentAt: string | null;
}

interface DealTranscript {
  dealRecordId: string;
  conversationCount: number;
  messageCount: number;
  channels: Array<{
    conversationId: string;
    channelType: "email" | "whatsapp";
    channelName: string;
    channelAddress: string;
    contactName: string | null;
    subject: string | null;
  }>;
  messages: TranscriptMessage[];
}

interface DealInsights {
  extracted: {
    customer_name: string | null;
    move_date: string | null;
    move_from_address: string | null;
    move_to_address: string | null;
    floors: string | null;
    inventory_notes: string | null;
    estimated_value_eur: number | null;
    customer_phone: string | null;
    customer_email: string | null;
  };
  missingFields: string[];
  openCustomerQuestions: string[];
  legalFlags: Array<{ topic: string; reason: string }>;
  summary: string;
}

interface InsightsResponse {
  dealRecordId: string;
  transcript: DealTranscript;
  insights: DealInsights | null;
  error?: string;
  applied?: boolean;
  fieldsUpdated?: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DealInsightsTab({ recordId }: { recordId: string }) {
  const [transcript, setTranscript] = useState<DealTranscript | null>(null);
  const [insights, setInsights] = useState<DealInsights | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastApplied, setLastApplied] = useState<string[] | null>(null);

  const loadTranscript = useCallback(async () => {
    setTranscriptLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/insights`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { transcript: DealTranscript };
      setTranscript(data.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load transcript");
    } finally {
      setTranscriptLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    loadTranscript();
  }, [loadTranscript]);

  const runExtraction = async (apply = true) => {
    setExtracting(true);
    setError(null);
    setLastApplied(null);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()).data as InsightsResponse;
      setTranscript(data.transcript);
      setInsights(data.insights);
      if (data.applied && data.fieldsUpdated) {
        setLastApplied(data.fieldsUpdated);
      }
      if (data.error) setError(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  if (transcriptLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lade Chatverlauf…
      </div>
    );
  }

  if (!transcript || transcript.messageCount === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Noch keine Nachrichten mit diesem Deal verknüpft. Sobald der Kunde
        antwortet, kann hier eine KI-Auswertung erstellt werden.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Linked conversations */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          Verknüpfte Chats
        </div>
        <div className="flex flex-wrap gap-2">
          {transcript.channels.map((c) => (
            <div
              key={c.conversationId}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
            >
              {c.channelType === "whatsapp" ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#25D366]/10">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="#25D366">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                </span>
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#96c11f]/10 text-[9px] font-bold text-[#5f7c13]">
                  K
                </span>
              )}
              <div>
                <div className="font-medium">{c.channelName}</div>
                <div className="text-muted-foreground">
                  {c.contactName ?? "Unbekannt"}
                  {c.subject ? ` · ${c.subject}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {transcript.messageCount} Nachrichten in {transcript.conversationCount}{" "}
          Unterhaltung{transcript.conversationCount === 1 ? "" : "en"}
        </p>
      </section>

      {/* Action row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button onClick={() => runExtraction(true)} disabled={extracting} size="sm">
            {extracting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Analysiere…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                {insights ? "Erneut auswerten" : "Mit KI auswerten"}
              </>
            )}
          </Button>
          {lastApplied && lastApplied.length > 0 && (
            <span className="text-xs text-green-600">
              {lastApplied.length} Felder aktualisiert
            </span>
          )}
        </div>
        {insights && (
          <span className="text-[10px] text-muted-foreground">
            Daten werden automatisch in den Deal übernommen
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Insights */}
      {insights && (
        <div className="space-y-5">
          {/* Summary */}
          <Section icon={<MessageSquare className="h-4 w-4" />} title="Zusammenfassung">
            <p className="text-sm leading-relaxed">{insights.summary}</p>
          </Section>

          {/* Extracted fields */}
          <Section icon={<Sparkles className="h-4 w-4" />} title="Extrahierte Daten">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Kundenname" value={insights.extracted.customer_name} />
              <Field label="Umzugsdatum" value={insights.extracted.move_date} />
              <Field label="Von" value={insights.extracted.move_from_address} />
              <Field label="Nach" value={insights.extracted.move_to_address} />
              <Field label="Etagen" value={insights.extracted.floors} />
              <Field
                label="Geschätzter Wert"
                value={
                  insights.extracted.estimated_value_eur != null
                    ? `${insights.extracted.estimated_value_eur} €`
                    : null
                }
              />
              <Field label="Telefon" value={insights.extracted.customer_phone} />
              <Field label="E-Mail" value={insights.extracted.customer_email} />
            </dl>
            {insights.extracted.inventory_notes && (
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Inventar
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {insights.extracted.inventory_notes}
                </p>
              </div>
            )}
          </Section>

          {/* Missing fields */}
          {insights.missingFields.length > 0 && (
            <Section
              icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
              title="Noch fehlende Informationen"
            >
              <ul className="space-y-1 text-sm">
                {insights.missingFields.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-amber-500">•</span>
                    {f}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Open questions */}
          {insights.openCustomerQuestions.length > 0 && (
            <Section
              icon={<HelpCircle className="h-4 w-4 text-blue-500" />}
              title="Offene Fragen des Kunden"
            >
              <ul className="space-y-1 text-sm">
                {insights.openCustomerQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-blue-500">•</span>
                    {q}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Legal flags */}
          {insights.legalFlags.length > 0 && (
            <Section
              icon={<Scale className="h-4 w-4 text-purple-500" />}
              title="Rechtliche Hinweise (AGB ggf. verlinken)"
            >
              <ul className="space-y-2 text-sm">
                {insights.legalFlags.map((f, i) => (
                  <li key={i}>
                    <div className="font-medium">{f.topic}</div>
                    <div className="text-xs text-muted-foreground">{f.reason}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={`text-sm ${value ? "" : "text-muted-foreground/60 italic"}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
