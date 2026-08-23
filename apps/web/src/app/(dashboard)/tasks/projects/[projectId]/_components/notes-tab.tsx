"use client";

// Notes tab. One TipTap document per project stored in projects.notes_content
// (Spec §10.4), autosaved 1.2 s after the last keystroke.
//
// Two failure modes this file specifically guards against:
//  - Radix unmounts an inactive TabsContent (components/ui/tabs.tsx), so a
//    cleanup that only clears the debounce timer silently drops the last
//    keystroke. The cleanup flushes the pending save immediately instead,
//    with `keepalive: true` so the request is not tied to this component's
//    lifetime (defect R3).
//  - After a save, the page-level `project` object must be refreshed via
//    `reload` so a later remount of this tab (switching away and back) does
//    not re-seed the editor from the pre-save value and make the user
//    retype their text (defect W12). `timer.current` is the single source
//    of truth for "there is an unflushed edit" — it survives a save that is
//    still in flight for an older snapshot, so a fast second edit is never
//    dropped by the first save's completion.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ProjectJSON } from "@/lib/work-types";
import { NoteEditor } from "@/components/notes/note-editor";
import { SectionCard } from "@/components/work/section-card";

export function NotesTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest unsaved content, kept independent of the timer so a flush can
  // always send the newest snapshot even while an older save is in flight.
  const pendingContent = useRef<unknown>(null);

  const save = useCallback(
    async (content: unknown, opts?: { keepalive?: boolean }) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/v1/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notesContent: content }),
          keepalive: opts?.keepalive ?? false,
        });
        if (!res.ok) throw new Error("save failed");
        setSavedAt(new Date());
        // Refresh the page-level project so a remount of this tab (Radix
        // unmounts inactive tabs) seeds the editor from the just-saved
        // value, not from whatever was current before this save (W12).
        await reload();
      } catch {
        toast.error("Notiz konnte nicht gespeichert werden");
      } finally {
        setSaving(false);
      }
    },
    [project.id, reload]
  );

  const onChange = useCallback(
    (content: unknown) => {
      pendingContent.current = content;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        save(pendingContent.current);
      }, 1200);
    },
    [save]
  );

  useEffect(
    () => () => {
      // Flush, don't just clear: a bare clearTimeout on unmount would
      // discard the last keystroke whenever the user switches tabs inside
      // the debounce window. Nothing to flush (timer.current === null)
      // covers both "nothing was typed" (W12 — no PATCH on an untouched,
      // empty note) and "the debounce already fired on its own".
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        save(pendingContent.current, { keepalive: true });
      }
    },
    [save]
  );

  return (
    <SectionCard
      title="Notizen"
      subtitle="Ein zusammenhängender Text je Projekt · speichert automatisch"
      action={
        <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
          {saving ? (
            <>
              <Loader2 className="h-[12px] w-[12px] animate-spin" />
              Speichert…
            </>
          ) : savedAt ? (
            <>
              <Check className="h-[12px] w-[12px]" style={{ color: "var(--ok)" }} />
              {savedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} gespeichert
            </>
          ) : null}
        </span>
      }
    >
      <NoteEditor
        content={project.notesContent ?? null}
        onChange={onChange}
        placeholder="Notizen zum Projekt — Entscheidungen, offene Fragen, Absprachen…"
      />
    </SectionCard>
  );
}
