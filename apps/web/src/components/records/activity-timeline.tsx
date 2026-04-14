"use client";

import { useState } from "react";
import {
  StickyNote,
  CheckSquare,
  UserPlus,
  Clock,
  MessageSquare,
  History,
  ArrowRight,
  Loader2,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

type Actor = { id: string; name: string | null; email: string | null } | null;

type ActivityItem =
  | {
      id: string;
      type: "created";
      createdAt: string;
      actor: Actor;
    }
  | {
      id: string;
      type: "comment";
      content: string;
      createdAt: string;
      actor: Actor;
    }
  | {
      id: string;
      type: "change";
      attributeSlug: string;
      attributeTitle: string;
      attributeType: string;
      oldValue: unknown;
      newValue: unknown;
      createdAt: string;
      actor: Actor;
    }
  | {
      id: string;
      type: "note";
      title: string;
      createdAt: string;
      actor: Actor;
    }
  | {
      id: string;
      type: "task";
      title: string;
      completed: boolean;
      deadline: string | null;
      createdAt: string;
      actor: Actor;
    };

interface ActivityTimelineProps {
  activities: ActivityItem[];
  /** Slug + id let the timeline post new comments and refresh itself. */
  objectSlug?: string;
  recordId?: string;
  onCommentPosted?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────

function actorLabel(actor: Actor): string {
  if (!actor) return "Someone";
  return actor.name || actor.email || "Someone";
}

function actorInitials(actor: Actor): string {
  if (!actor) return "?";
  const src = actor.name || actor.email || "?";
  return src
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Render a change value as a short human-readable label. Best-effort —
 * covers the common attribute types the CRM uses.
 */
function renderValue(value: unknown, type: string): string {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    return value.map((v) => renderValue(v, type)).join(", ") || "—";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // personal_name
    if ("fullName" in obj && typeof obj.fullName === "string") return obj.fullName;
    // currency
    if ("amount" in obj && "currency" in obj) return `${obj.amount} ${obj.currency}`;
    // location
    if ("line1" in obj || "city" in obj || "country" in obj) {
      return [obj.line1, obj.city, obj.country].filter(Boolean).join(", ") || "—";
    }
    // select / status / record_reference — often hydrated as { id, title, color }
    if ("title" in obj && typeof obj.title === "string") return obj.title;
    if ("displayName" in obj && typeof obj.displayName === "string")
      return obj.displayName as string;
    try {
      return JSON.stringify(obj);
    } catch {
      return "—";
    }
  }

  return String(value);
}

// ─── Component ────────────────────────────────────────────────────

export function ActivityTimeline({
  activities,
  objectSlug,
  recordId,
  onCommentPosted,
}: ActivityTimelineProps) {
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const canComment = !!(objectSlug && recordId);

  async function handlePost() {
    if (!canComment || !comment.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(
        `/api/v1/objects/${objectSlug}/records/${recordId}/activity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: comment.trim() }),
        }
      );
      if (res.ok) {
        setComment("");
        onCommentPosted?.();
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Inline comment composer */}
      {canComment && (
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Write an update… (mentions and replies coming soon)"
                rows={2}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    handlePost();
                  }
                }}
                className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to post</p>
                <button
                  onClick={handlePost}
                  disabled={!comment.trim() || posting}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {posting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Post update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      {activities.length === 0 ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          No activity yet.
        </div>
      ) : (
        <div className="relative space-y-0">
          <div className="absolute left-[19px] top-3 bottom-3 w-px bg-border" />
          {activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  return (
    <div className="relative flex gap-3 px-3 py-2">
      <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background">
        <ActivityIcon type={activity.type} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <ActivityBody activity={activity} />
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatRelativeTime(activity.createdAt)}
        </p>
      </div>
    </div>
  );
}

function ActivityBody({ activity }: { activity: ActivityItem }) {
  const who = actorLabel(activity.actor);

  switch (activity.type) {
    case "created":
      return (
        <p className="text-sm">
          <span className="font-medium">{who}</span> created this record
        </p>
      );

    case "comment":
      return (
        <div>
          <p className="text-sm">
            <span className="font-medium">{who}</span> posted an update
          </p>
          <div className="mt-1.5 rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">
            {activity.content}
          </div>
        </div>
      );

    case "change":
      return (
        <div className="text-sm">
          <span className="font-medium">{who}</span> changed{" "}
          <span className="font-medium">{activity.attributeTitle}</span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <ValueChip value={activity.oldValue} type={activity.attributeType} dimmed />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <ValueChip value={activity.newValue} type={activity.attributeType} />
          </div>
        </div>
      );

    case "note":
      return (
        <p className="text-sm">
          <span className="font-medium">{who}</span> added a note:{" "}
          <span className="text-muted-foreground">{activity.title}</span>
        </p>
      );

    case "task":
      return (
        <p className="text-sm">
          <span className="font-medium">{who}</span>{" "}
          {activity.completed ? "completed" : "created"} a task:{" "}
          <span className="text-muted-foreground">{activity.title}</span>
          {activity.deadline && (
            <span className="text-muted-foreground">
              {" "}
              · due {new Date(activity.deadline).toLocaleDateString()}
            </span>
          )}
        </p>
      );
  }
}

function ValueChip({
  value,
  type,
  dimmed,
}: {
  value: unknown;
  type: string;
  dimmed?: boolean;
}) {
  const rendered = renderValue(value, type);
  return (
    <span
      className={
        "inline-flex max-w-[14rem] truncate rounded px-1.5 py-0.5 " +
        (dimmed
          ? "bg-muted/60 text-muted-foreground line-through"
          : "bg-primary/10 text-foreground")
      }
      title={rendered}
    >
      {rendered}
    </span>
  );
}

function ActivityIcon({ type }: { type: ActivityItem["type"] }) {
  switch (type) {
    case "created":
      return <UserPlus className="h-3 w-3 text-green-500" />;
    case "comment":
      return <MessageSquare className="h-3 w-3 text-indigo-500" />;
    case "change":
      return <History className="h-3 w-3 text-amber-500" />;
    case "note":
      return <StickyNote className="h-3 w-3 text-blue-500" />;
    case "task":
      return <CheckSquare className="h-3 w-3 text-purple-500" />;
    default:
      return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
}
