"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  consumedTitle,
  extractDraftMessage,
  isAgentDraft,
  type RawDraftNote,
} from "@/lib/agent-drafts";

export interface DraftSuggestion {
  noteId: string;
  title: string;
  body: string;
  updatedAt: string;
}

interface DraftSuggestionBannerProps {
  dealRecordId: string;
  /**
   * Bumps when the host wants the banner to refetch (e.g. after a successful
   * send the host raises a counter so the banner re-checks the notes API and
   * hides itself once the title flip lands).
   */
  refreshKey?: number;
  onAcceptDraft: (text: string, suggestion: DraftSuggestion) => void;
}

export function DraftSuggestionBanner({
  dealRecordId,
  refreshKey = 0,
  onAcceptDraft,
}: DraftSuggestionBannerProps) {
  const [suggestion, setSuggestion] = useState<DraftSuggestion | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Re-fetch whenever the deal changes or the host bumps the refresh key.
  useEffect(() => {
    let cancelled = false;
    setSuggestion(null);
    setDismissed(false);
    setExpanded(false);

    async function load() {
      try {
        const res = await fetch(
          `/api/v1/objects/deals/records/${dealRecordId}/notes`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        const rows: RawDraftNote[] = Array.isArray(json?.data) ? json.data : [];

        // Drafts come back ordered by updatedAt desc (see getNotesForRecord).
        // Keep that order and pick the first matching draft.
        const drafts = rows.filter(isAgentDraft);
        if (drafts.length === 0 || cancelled) return;

        const top = drafts[0];
        const body = extractDraftMessage(top.content);
        if (!body) return;

        setSuggestion({
          noteId: top.id,
          title: top.title,
          body,
          updatedAt: typeof top.updatedAt === "string"
            ? top.updatedAt
            : new Date(top.updatedAt).toISOString(),
        });
      } catch {
        // Network / parse errors silently noop — banner just won't render.
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dealRecordId, refreshKey]);

  const previewLines = useMemo(() => {
    if (!suggestion) return [] as string[];
    return suggestion.body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  }, [suggestion]);

  const previewBody = useMemo(() => {
    if (!suggestion) return "";
    return expanded ? suggestion.body : previewLines.slice(0, 3).join("\n");
  }, [suggestion, expanded, previewLines]);

  const truncated = previewLines.length > 3;

  const handleAccept = useCallback(() => {
    if (!suggestion) return;
    onAcceptDraft(suggestion.body, suggestion);
  }, [suggestion, onAcceptDraft]);

  const handleDiscard = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!suggestion || dismissed) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-violet-500/30 bg-violet-500/5",
        "px-3 py-2 text-sm space-y-1.5"
      )}
      data-testid="draft-suggestion-banner"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-violet-700">
            Antwort-Entwurf · Sales Outreach Agent
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs text-foreground/90 mt-1 leading-snug">
            {previewBody}
            {!expanded && truncated ? "…" : ""}
          </pre>
          {truncated && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline mt-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  weniger anzeigen
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  alles ansehen
                </>
              )}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDiscard}
          className="shrink-0 p-1 rounded hover:bg-violet-500/10 text-muted-foreground hover:text-foreground transition-colors"
          title="Verwerfen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleDiscard}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Verwerfen
        </button>
        <button
          type="button"
          onClick={handleAccept}
          className="rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5"
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}

/**
 * Helper used by the composer after a successful send: flips the note title
 * from `Antwort-Entwurf · Sales Outreach Agent …` to
 * `Antwort-Entwurf · Übernommen am DD.MM.YYYY` so the banner won't re-show
 * the same suggestion next time the conversation is opened.
 *
 * Best-effort: a failed PATCH is logged but never surfaced to the user, since
 * the message has already been sent successfully.
 */
export async function markDraftConsumed(noteId: string): Promise<void> {
  try {
    await fetch(`/api/v1/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: consumedTitle() }),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Failed to mark draft note as consumed", err);
    }
  }
}

/** Public flag check so the host can avoid mounting the banner entirely. */
export function isDraftBannerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_AGENT_DRAFT_BANNER === "true";
}
