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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DealInsightsTab({ recordId }: { recordId: string }) {
  const [transcript, setTranscript] = useState<DealTranscript | null>(null);
  const [insights, setInsights] = useState<DealInsights | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const runExtraction = async () => {
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/insights`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as InsightsResponse;
      setTranscript(data.transcript);
      setInsights(data.insights);
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Chat-Übersicht</h3>
          <p className="text-xs text-muted-foreground">
            {transcript.messageCount} Nachrichten in {transcript.conversationCount}{" "}
            verknüpfte{transcript.conversationCount === 1 ? "r" : "n"} Unterhaltung
            {transcript.conversationCount === 1 ? "" : "en"} über{" "}
            {new Set(transcript.channels.map((c) => c.channelType)).size} Kanal/Kanäle.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {transcript.channels.map((c) => (
              <Badge key={c.conversationId} variant="secondary" className="text-[10px]">
                {c.channelType} · {c.channelName}
                {c.contactName ? ` · ${c.contactName}` : ""}
              </Badge>
            ))}
          </div>
        </div>
        <Button onClick={runExtraction} disabled={extracting} size="sm">
          {extracting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Analysiere…
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {insights ? "Erneut analysieren" : "Mit KI auswerten"}
            </>
          )}
        </Button>
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
