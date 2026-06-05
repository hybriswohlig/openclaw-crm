"use client";

import { useMemo, useRef, useState } from "react";
import {
  Camera,
  Video,
  Check,
  Loader2,
  AlertCircle,
  ClipboardList,
} from "lucide-react";
import { uploadAndRegisterMedia } from "@/lib/portal-upload";

type InitialMedia = {
  id: string;
  category: string;
  isVideo: boolean;
  isImage: boolean;
};

type StepDef = {
  category: string;
  label: string;
  type: "video" | "foto";
};

const STEPS: StepDef[] = [
  { category: "stairwell", label: "Treppenhaus (Video)", type: "video" },
  { category: "loading", label: "Sachen/Haus beim Einladen (Video)", type: "video" },
  { category: "overview", label: "Übersicht Wohnung", type: "foto" },
  { category: "damage", label: "Beschädigte Sachen", type: "foto" },
  { category: "truck_loaded", label: "Alles im Transporter", type: "foto" },
  { category: "final_loaded", label: "Endzustand verladen", type: "foto" },
];

type UploadedItem = { id: string; category: string };

export default function LeadDocs({
  workspaceId,
  dealRecordId,
  initialMedia,
}: {
  workspaceId: string;
  dealRecordId: string;
  initialMedia: InitialMedia[];
}) {
  const [uploaded, setUploaded] = useState<UploadedItem[]>([]);
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Stable starting set of ids per category from the initial media.
  const initialByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of initialMedia) {
      const list = map.get(m.category) ?? [];
      list.push(m.id);
      map.set(m.category, list);
    }
    return map;
  }, [initialMedia]);

  function idsForCategory(category: string): string[] {
    const base = initialByCategory.get(category) ?? [];
    const extra = uploaded.filter((u) => u.category === category).map((u) => u.id);
    return [...base, ...extra];
  }

  const totalDone = STEPS.filter((s) => idsForCategory(s.category).length >= 1).length;

  async function handleFile(step: StepDef, file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusyCategory(step.category);
    setProgress(0);
    try {
      const { id } = await uploadAndRegisterMedia({
        file,
        fileName: file.name,
        workspaceId,
        dealRecordId,
        category: step.category,
        onProgress: (pct) => setProgress(pct),
      });
      setUploaded((prev) => [...prev, { id, category: step.category }]);
    } catch {
      setError("Hochladen fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusyCategory(null);
      setProgress(0);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">Dokumentation</h2>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {totalDone} von {STEPS.length} erledigt
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        Bitte alle Schritte direkt am Einsatzort mit der Handykamera erfassen. Das
        schützt dich und uns bei Reklamationen.
      </p>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="space-y-4">
        {STEPS.map((step) => (
          <StepCard
            key={step.category}
            step={step}
            ids={idsForCategory(step.category)}
            busy={busyCategory === step.category}
            progress={busyCategory === step.category ? progress : 0}
            disabled={busyCategory !== null && busyCategory !== step.category}
            onFile={(file) => handleFile(step, file)}
          />
        ))}
      </div>
    </section>
  );
}

function StepCard({
  step,
  ids,
  busy,
  progress,
  disabled,
  onFile,
}: {
  step: StepDef;
  ids: string[];
  busy: boolean;
  progress: number;
  disabled: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isVideo = step.type === "video";
  const done = ids.length >= 1;
  const count = ids.length;
  const Icon = isVideo ? Video : Camera;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
              (done
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground")
            }
            aria-hidden
          >
            {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-base font-medium text-foreground">{step.label}</p>
            <p className="text-xs text-muted-foreground">
              {count === 0
                ? isVideo
                  ? "Noch kein Video erfasst"
                  : "Noch kein Foto erfasst"
                : count === 1
                  ? isVideo
                    ? "1 Video erfasst"
                    : "1 Foto erfasst"
                  : isVideo
                    ? count + " Videos erfasst"
                    : count + " Fotos erfasst"}
            </p>
          </div>
        </div>
      </div>

      {count > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {ids.map((id) => (
            <a
              key={id}
              href={"/api/v1/portal/media/" + id}
              target="_blank"
              rel="noreferrer"
              className="block h-16 w-16 overflow-hidden rounded-lg border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={"/api/v1/portal/media/" + id}
                alt={step.label}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={isVideo ? "video/*" : "image/*"}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          onFile(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-base font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span>Wird hochgeladen {progress}%</span>
          </>
        ) : (
          <>
            <Icon className="h-5 w-5" aria-hidden />
            <span>
              {count > 0
                ? isVideo
                  ? "Weiteres Video aufnehmen"
                  : "Weiteres Foto aufnehmen"
                : isVideo
                  ? "Video aufnehmen"
                  : "Foto aufnehmen"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
