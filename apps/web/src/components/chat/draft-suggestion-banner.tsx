"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Title prefix produced by the Sales Outreach Agent in Paperclip when it
// drops a reply suggestion onto a deal. The banner only surfaces notes that
// start with this prefix and have not yet been marked as consumed.
const DRAFT_TITLE_PREFIX = "Antwort-Entwurf · Sales Outreach Agent";
const CONSUMED_TITLE_MARKER = "Übernommen";

interface RawNote {
  id: string;
  recordId: string;
  title: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
}

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

/**
 * Pulls draft text out of TipTap JSON. Mirrors the server-side helper in
 * services/deal-insights.ts so the banner doesn't need a round-trip through
 * a server route just to render a preview.
 */
function tiptapToPlainText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (typeof n.text === "string") return n.text;
  const content = n.content;
  if (Array.isArray(content)) {
    const isBlock = ["paragraph", "heading", "listItem", "blockquote"].includes(
      typeof n.type === "string" ? n.type : ""
    );
    return content.map(tiptapToPlainText).join("") + (isBlock ? "\n" : "");
  }
  return "";
}

/**
 * The Sales-Outreach-Agent emits draft notes shaped roughly like:
 *
 *     Antwort-Entwurf · Sales Outreach Agent              ← header line
 *     ---                                                  ← horizontal rule
 *     Betreff: Re: Anfrage Umzug                           ← optional subject
 *     Hallo R.H.,
 *     <email body paragraphs ending with the signature>
 *     ---                                                  ← horizontal rule
 *     ## Verkaufspsychologische Hebel                      ← analysis (skip)
 *     ## Was bewusst weggelassen wurde
 *     ## Conversion-Einschätzung
 *     ---
 *     *Quelle für Tonalität ... PR #6 ...*                 ← italic citation
 *
 * Only the email body should land in the composer. Walk the top-level
 * TipTap nodes and drop the scaffolding bits explicitly: the title repeat,
 * `Betreff:` / `Subject:` lines, horizontal rules, headings + everything
 * after them, and italic-only "source" footer paragraphs.
 *
 * If the heuristics over-strip (note doesn't follow this shape), fall back
 * to the full plain-text body so the human at least has something editable
 * instead of an empty composer.
 */

function paragraphIsAllItalic(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { content?: unknown };
  if (!Array.isArray(n.content) || n.content.length === 0) return false;
  let sawText = false;
  for (const child of n.content) {
    const c = child as { type?: string; text?: string; marks?: unknown };
    if (c.type !== "text") return false;
    if (typeof c.text !== "string" || c.text.length === 0) continue;
    sawText = true;
    const marks = Array.isArray(c.marks) ? c.marks : [];
    const italic = marks.some(
      (m) => (m as { type?: string }).type === "italic"
    );
    if (!italic) return false;
  }
  return sawText;
}

function isAgentHeaderLine(line: string): boolean {
  return /^antwort[-\s]?entwurf\s*[·•|–-]\s*sales\s+outreach\s+agent/i.test(
    line
  );
}

function isSubjectLine(line: string): boolean {
  return /^(betreff|subject)\s*:/i.test(line);
}

function extractDraftMessage(content: unknown): string {
  const fullText = tiptapToPlainText(content).trim();
  if (!content || typeof content !== "object") return fullText;
  const root = content as { content?: unknown };
  const top = Array.isArray(root.content) ? root.content : null;
  if (!top) return fullText;

  const kept: unknown[] = [];
  let inAnalysis = false;
  for (const child of top) {
    if (inAnalysis) continue;
    const c = child as { type?: string };

    // Hard stops: anything from here on is agent commentary, not the email.
    if (c.type === "heading") {
      inAnalysis = true;
      continue;
    }
    // Drop separators between sections.
    if (c.type === "horizontalRule") continue;

    if (c.type === "paragraph") {
      const line = tiptapToPlainText(child).trim();
      if (line.length === 0) {
        if (kept.length > 0) kept.push(child);
        continue;
      }
      if (isAgentHeaderLine(line)) continue;
      if (isSubjectLine(line)) continue;
      // Italic-only paragraph AFTER the body is the citation footer
      // (`*Quelle … PR #6 …*`). If we haven't started collecting the email
      // yet it's just preamble — drop it without entering analysis mode.
      if (paragraphIsAllItalic(child)) {
        if (kept.length > 0) inAnalysis = true;
        continue;
      }
      kept.push(child);
      continue;
    }
    // Lists, blockquotes, code, etc.: keep them as part of the body.
    kept.push(child);
  }

  // Drop trailing blank paragraphs introduced by the skip rules above.
  while (kept.length > 0) {
    const last = kept[kept.length - 1];
    if (tiptapToPlainText(last).trim().length === 0) {
      kept.pop();
    } else break;
  }

  const trimmed = tiptapToPlainText({ type: "doc", content: kept }).trim();
  if (trimmed.length < 40 && fullText.length >= 40) return fullText;
  return trimmed || fullText;
}

function isAgentDraft(note: RawNote): boolean {
  const t = note.title ?? "";
  if (!t.startsWith(DRAFT_TITLE_PREFIX)) return false;
  if (t.includes(CONSUMED_TITLE_MARKER)) return false;
  return true;
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
        const rows: RawNote[] = Array.isArray(json?.data) ? json.data : [];

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
          updatedAt: top.updatedAt,
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
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const newTitle = `Antwort-Entwurf · ${CONSUMED_TITLE_MARKER} am ${dd}.${mm}.${yyyy}`;
    await fetch(`/api/v1/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
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
