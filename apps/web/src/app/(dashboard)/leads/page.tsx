"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useObjectRecords } from "@/hooks/use-object-records";
import { RecordKanban } from "@/components/records/record-kanban";
import { RecordTable } from "@/components/records/record-table";
import { RecordCreateModal } from "@/components/records/record-create-modal";
import { LEAD_STAGE_GROUPS } from "@openclaw-crm/shared";
import { Button } from "@/components/ui/button";
import { Kanban, Table2, Plus, Loader2, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LeadsPage() {
  const router = useRouter();
  const {
    object,
    records,
    total,
    loading,
    fetchData,
    updateRecord,
    createRecord,
  } = useObjectRecords("deals");

  const [view, setView] = useState<"board" | "table">("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeCountry, setActiveCountry] = useState<string | null>(null);

  const statusAttr = object?.attributes.find((a) => a.type === "status");
  const statusSlug = statusAttr?.slug ?? "stage";
  const statuses = statusAttr?.statuses ?? [];

  const countryAttr = object?.attributes.find((a) => a.slug === "country");
  const countryOptions = countryAttr?.options ?? [];

  // Count records per stage group
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of LEAD_STAGE_GROUPS) {
      const groupStatusIds = new Set(
        statuses.filter((s) => group.stages.includes(s.title)).map((s) => s.id)
      );
      counts[group.label] = records.filter((r) => {
        const stageVal = r.values[statusSlug] as string | undefined;
        return stageVal && groupStatusIds.has(stageVal);
      }).length;
    }
    return counts;
  }, [records, statuses, statusSlug]);

  // Count records per country
  const countryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of records) {
      const c = r.values.country as string | undefined;
      if (!c) continue;
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [records]);

  // Filter records + kanban columns by active group and country
  const { filteredRecords, filteredAttributes } = useMemo(() => {
    if (!object) {
      return {
        filteredRecords: [] as typeof records,
        filteredAttributes: [] as NonNullable<typeof object>["attributes"],
      };
    }

    let filtered = records;

    if (activeGroup && statusAttr) {
      const group = LEAD_STAGE_GROUPS.find((g: { label: string }) => g.label === activeGroup);
      if (group) {
        const groupStatusIds = new Set(
          statuses.filter((s) => group.stages.includes(s.title)).map((s) => s.id)
        );
        filtered = filtered.filter((r) => {
          const stageVal = r.values[statusSlug] as string | undefined;
          return stageVal && groupStatusIds.has(stageVal);
        });
      }
    }

    if (activeCountry) {
      filtered = filtered.filter((r) => r.values.country === activeCountry);
    }

    // Restrict kanban columns to the active group's stages
    const attrs = object.attributes.map((attr) => {
      if (!activeGroup || attr.id !== statusAttr?.id) return attr;
      const group = LEAD_STAGE_GROUPS.find((g: { label: string }) => g.label === activeGroup);
      if (!group) return attr;
      return {
        ...attr,
        statuses: (attr.statuses ?? []).filter((s) => group.stages.includes(s.title)),
      };
    });

    return { filteredRecords: filtered, filteredAttributes: attrs };
  }, [object, records, statuses, statusAttr, statusSlug, activeGroup, activeCountry]);

  function handleMoveRecord(recordId: string, newStatusId: string) {
    updateRecord(recordId, statusSlug, newStatusId);
  }

  async function handleReorder(columnRecordIds: string[]) {
    await fetch(`/api/v1/objects/deals/records/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordIds: columnRecordIds }),
    });
    fetchData();
  }

  if (loading && !object) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!object) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground px-6">
        <Target className="h-12 w-12 opacity-30" />
        <div className="text-center max-w-sm">
          <p className="text-base font-medium text-foreground">Lead pipeline not set up yet</p>
          <p className="text-sm mt-2">
            The standard objects for this workspace are missing. Go to{" "}
            <Link href="/admin/database" className="text-primary underline">
              Admin → Database
            </Link>{" "}
            and click <span className="font-medium">Seed / repair workspace objects</span>.
          </p>
        </div>
      </div>
    );
  }

  const displayTotal = activeGroup || activeCountry ? filteredRecords.length : total;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 border-r border-border flex flex-col overflow-y-auto bg-background/50">
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pipeline
          </h2>
        </div>

        {/* All leads */}
        <button
          onClick={() => setActiveGroup(null)}
          className={cn(
            "flex items-center justify-between px-4 py-2 text-sm transition-colors",
            activeGroup === null
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <span>All Leads</span>
          <span className="text-xs tabular-nums">{total}</span>
        </button>

        <div className="my-1 mx-4 h-px bg-border" />

        {/* Stage groups */}
        {LEAD_STAGE_GROUPS.map((group: { label: string; stages: string[]; color: string }) => {
          const isActive = activeGroup === group.label;
          return (
            <div key={group.label}>
              <button
                onClick={() => setActiveGroup(isActive ? null : group.label)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: group.color }}
                  />
                  <span>{group.label}</span>
                </div>
                <span className="text-xs tabular-nums">{groupCounts[group.label] ?? 0}</span>
              </button>

              {isActive && (
                <div className="pb-1">
                  {group.stages.map((stageName: string) => {
                    const status = statuses.find((s) => s.title === stageName);
                    const count = status
                      ? records.filter((r) => r.values[statusSlug] === status.id).length
                      : 0;
                    return (
                      <div
                        key={stageName}
                        className="flex items-center justify-between px-10 py-1 text-xs text-muted-foreground"
                      >
                        <span className="truncate">{stageName}</span>
                        <span className="tabular-nums ml-2">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Countries */}
        {countryOptions.length > 0 && Object.keys(countryCounts).length > 0 && (
          <>
            <div className="px-4 pt-5 pb-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Country
              </h2>
            </div>
            <button
              onClick={() => setActiveCountry(null)}
              className={cn(
                "flex items-center justify-between px-4 py-1.5 text-sm transition-colors",
                activeCountry === null
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span>All countries</span>
            </button>
            {countryOptions
              .filter((opt) => countryCounts[opt.id])
              .map((opt) => (
                <button
                  key={opt.id}
                  onClick={() =>
                    setActiveCountry(activeCountry === opt.id ? null : opt.id)
                  }
                  className={cn(
                    "flex items-center justify-between px-4 py-1.5 text-sm transition-colors",
                    activeCountry === opt.id
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: opt.color }}
                    />
                    <span className="truncate">{opt.title}</span>
                  </div>
                  <span className="text-xs tabular-nums ml-2">
                    {countryCounts[opt.id]}
                  </span>
                </button>
              ))}
          </>
        )}

        <div className="flex-1" />
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">
              {activeGroup ?? "All Leads"}
            </h1>
            <span className="text-sm text-muted-foreground">
              {displayTotal} lead{displayTotal === 1 ? "" : "s"}
            </span>
            {activeCountry && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                {countryOptions.find((o) => o.id === activeCountry)?.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {statusAttr && (
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => setView("board")}
                  className={cn(
                    "px-2 py-1 text-xs flex items-center gap-1 transition-colors",
                    view === "board"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <Kanban className="h-3.5 w-3.5" />
                  Board
                </button>
                <button
                  onClick={() => setView("table")}
                  className={cn(
                    "px-2 py-1 text-xs flex items-center gap-1 transition-colors border-l border-border",
                    view === "table"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Table
                </button>
              </div>
            )}

            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Lead
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {view === "board" && statusAttr ? (
            <RecordKanban
              attributes={filteredAttributes as any}
              records={filteredRecords}
              statusAttributeSlug={statusSlug}
              onMoveRecord={handleMoveRecord}
              onReorder={handleReorder}
              onClickRecord={(id) => router.push(`/objects/deals/${id}`)}
              objectSlug="deals"
            />
          ) : (
            <RecordTable
              attributes={object.attributes as any}
              records={filteredRecords}
              onUpdateRecord={updateRecord}
              onCreateRecord={() => setCreateOpen(true)}
              objectSlug="deals"
            />
          )}
        </div>
      </div>

      <RecordCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (values) => {
          await createRecord(values);
          setCreateOpen(false);
        }}
        attributes={object.attributes as any}
        objectName={object.singularName}
      />
    </div>
  );
}
