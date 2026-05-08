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
 * services/deal-insights.ts but also emits `\n` for `hardBreak` nodes so
 * notes that pack the whole draft into a single paragraph (with `<br>`
 * line breaks) still render with usable line structure.
 */
function tiptapToPlainText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "hardBreak") return "\n";
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
 * The Sales-Outreach-Agent emits draft notes in two observed shapes:
 *
 *   Format A (R.H.-style, uses TipTap markdown features):
 *     [paragraph] Antwort-Entwurf · Sales Outreach Agent
 *     [horizontalRule]
 *     [paragraph] Hallo R.H.,
 *     <email body>
 *     [paragraph] Kottke Dienstleistungen
 *     [horizontalRule]
 *     [heading] Verkaufspsychologische Hebel
 *     <analysis>
 *     [horizontalRule]
 *     [paragraph italic] Quelle für Tonalität ... PR #6 ...
 *
 *   Format B (Josefine-style, plain-text scaffolding):
 *     [paragraph] Kanal: Kleinanzeigen ... Phase: Closing — ...
 *     [paragraph] ────────────  ENTWURF (nicht versendet)  ────────────
 *     [paragraph] Hallo Josefine,
 *     <email body>
 *     [paragraph] Nuri
 *     [paragraph] ──────────────────────────────────────────────
 *     [paragraph] Verkaufspsychologische Hebel:
 *     [orderedList] 1. ... 2. ...
 *     [paragraph] Bewusst weggelassen:
 *     [bulletList] ...
 *     [paragraph] Wahrscheinliche Antwort:
 *     <analysis paragraphs>
 *     [paragraph] Referenz: Paperclip KOT-554.
 *
 * Both shapes can be read with the same state machine:
 *
 *   preamble ──[separator OR greeting]──► body ──[separator/heading/
 *   known-section-label/italic-citation]──► analysis (terminal)
 *
 * Separators include TipTap horizontalRule, headings (Format A), and
 * paragraphs whose plain text is mostly box-drawing / dash glyphs (Format B).
 * Section labels (`Verkaufspsychologische Hebel:`, `Bewusst weggelassen:`,
 * `Wahrscheinliche Antwort:`, `Referenz:`, `Quelle:` …) terminate body even
 * without a preceding separator, in case the agent drops one.
 *
 * Fallback: if the cleanup ends up nearly empty, return the full plain-text
 * body so the human still has something editable.
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

// Box-drawing, dashes, equals, underscores, asterisks, tildes — anything that
// can be repeated to form a visual "──── ENTWURF ────" / "═════" line.
const SEPARATOR_GLYPHS = /[─━═│┃║╔╗╚╝╠╣╦╩╬\-_=*•~⎯]/g;

function paragraphIsSeparator(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  const glyphs = t.match(SEPARATOR_GLYPHS) || [];
  if (glyphs.length < 6) return false;
  // Allow short labels embedded in the line ("ENTWURF (nicht versendet)").
  const rest = t.replace(SEPARATOR_GLYPHS, "").replace(/\s+/g, " ").trim();
  return rest.length <= 50;
}

const PREAMBLE_LINE_PATTERNS: RegExp[] = [
  /^antwort[-\s]?entwurf\s*[·•|–-]\s*sales\s+outreach\s+agent/i,
  /^kanal\s*:/i,
  /^ton(alit[äa]t)?\s*:/i,
  /^phase\s*:/i,
  /^betreff\s*:/i,
  /^subject\s*:/i,
];

function isPreambleLine(line: string): boolean {
  return PREAMBLE_LINE_PATTERNS.some((re) => re.test(line));
}

const ANALYSIS_LABEL_PATTERNS: RegExp[] = [
  /^verkaufspsychologische\s+hebel\b/i,
  /^(was\s+)?bewusst\s+weggelassen\b/i,
  /^wahrscheinliche\s+antwort\b/i,
  /^conversion[-\s]?einsch[äa]tzung\b/i,
  /^kontext\s+zu(m|r)?\b/i,
  /^referenz\s*:/i,
  /^quelle\s*:/i,
];

function isAnalysisSectionLabel(line: string): boolean {
  return ANALYSIS_LABEL_PATTERNS.some((re) => re.test(line));
}

const GREETING_PATTERNS: RegExp[] = [
  /^hallo\b/i,
  /^hi\b/i,
  /^hey\b/i,
  /^moin\b/i,
  /^guten\s+(tag|morgen|abend)\b/i,
  /^sehr\s+geehrt(er?|e\s+(frau|herr|damen))/i,
  /^liebe[rsn]?\b/i,
];

function looksLikeGreeting(line: string): boolean {
  return GREETING_PATTERNS.some((re) => re.test(line));
}

/**
 * String-level fallback: when the structural walker fails to find a clean
 * email body (because the agent packed everything into a single paragraph,
 * used unfamiliar node types, or wrote scaffolding lines we did not classify),
 * try the same heuristics on the rendered plain text — find the first
 * greeting, slice up to the first section label or separator line.
 *
 * Returns null if no greeting is found or the resulting body is too short to
 * be useful; callers should then fall back to the full text.
 */
function extractFromPlainText(text: string): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeGreeting(lines[i].trim())) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const isSepLine = (line: string) => paragraphIsSeparator(line);
  const isLabelLine = (line: string) => isAnalysisSectionLabel(line.trim());

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (isSepLine(lines[i]) || isLabelLine(lines[i])) {
      endIdx = i;
      break;
    }
  }

  // Trim trailing blank lines.
  while (endIdx > startIdx + 1 && lines[endIdx - 1].trim().length === 0) {
    endIdx--;
  }

  const body = lines.slice(startIdx, endIdx).join("\n").trim();
  if (body.length < 40) return null;
  return body;
}

function extractDraftMessage(content: unknown): string {
  const fullText = tiptapToPlainText(content).trim();
  if (!content || typeof content !== "object") {
    return extractFromPlainText(fullText) ?? fullText;
  }
  const root = content as { content?: unknown };
  const top = Array.isArray(root.content) ? root.content : null;
  if (!top) return extractFromPlainText(fullText) ?? fullText;

  const kept: unknown[] = [];
  type State = "preamble" | "body" | "analysis";
  let state: State = "preamble";

  for (const child of top) {
    if (state === "analysis") continue;
    const c = child as { type?: string };

    // Headings: in preamble they're typically a title-as-heading repeat —
    // skip and wait for the real start signal. In body they unambiguously
    // mark the beginning of the analysis sections.
    if (c.type === "heading") {
      if (state === "body") state = "analysis";
      continue;
    }
    // TipTap horizontalRules are explicit section breaks.
    if (c.type === "horizontalRule") {
      state = state === "preamble" ? "body" : "analysis";
      continue;
    }

    if (c.type === "paragraph") {
      const line = tiptapToPlainText(child).trim();

      // Visual separators ("──── ENTWURF ────", "═════") flip state too.
      if (paragraphIsSeparator(line)) {
        state = state === "preamble" ? "body" : "analysis";
        continue;
      }

      // Section labels ("Verkaufspsychologische Hebel:", "Referenz:" …).
      if (line.length > 0 && isAnalysisSectionLabel(line)) {
        state = "analysis";
        continue;
      }

      // Italic-only paragraph: the source citation. Stops body if seen mid-doc;
      // in preamble it's just a footnote-style caption — drop it silently.
      if (paragraphIsAllItalic(child)) {
        if (state === "body") state = "analysis";
        continue;
      }

      if (state === "preamble") {
        if (line.length === 0) continue;
        if (isPreambleLine(line)) continue;
        // Greeting reliably marks the start of the email body.
        if (looksLikeGreeting(line)) {
          state = "body";
          kept.push(child);
          continue;
        }
        // Unknown line in preamble: keep skipping. If no greeting and no
        // separator ever appears, the fallback returns the full text.
        continue;
      }

      // state === "body"
      if (line.length === 0) {
        if (kept.length > 0) kept.push(child);
        continue;
      }
      // Defense-in-depth: a stray "Betreff:" inside the body is still scaffolding.
      if (isPreambleLine(line)) continue;
      kept.push(child);
      continue;
    }

    // Lists, blockquotes, code blocks, etc.
    if (state === "body") {
      kept.push(child);
    }
  }

  // Drop trailing blank paragraphs introduced by the skip rules above.
  while (kept.length > 0) {
    const last = kept[kept.length - 1];
    if (tiptapToPlainText(last).trim().length === 0) {
      kept.pop();
    } else break;
  }

  const trimmed = tiptapToPlainText({ type: "doc", content: kept }).trim();
  if (trimmed.length >= 40) return trimmed;

  // Structural extraction came up short — try string-level extraction on the
  // rendered plain text. Handles the case where the agent wrote the entire
  // note as one paragraph with hardBreaks, or used custom node types that
  // the state machine does not recognize.
  const stringLevel = extractFromPlainText(fullText);
  if (stringLevel) return stringLevel;

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
