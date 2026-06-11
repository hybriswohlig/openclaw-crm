"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useObjectRecords } from "@/hooks/use-object-records";
import { RecordTable } from "@/components/records/record-table";
import { RecordKanban } from "@/components/records/record-kanban";
import { RecordCreateModal } from "@/components/records/record-create-modal";
import { FilterBuilder } from "@/components/filters/filter-builder";
import { FilterBar } from "@/components/filters/filter-bar";
import { SortBuilder } from "@/components/filters/sort-builder";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CSVImportModal } from "@/components/records/csv-import-modal";
import { generateCSV, downloadCSV } from "@/lib/csv-utils";
import {
  Plus,
  RefreshCw,
  Table2,
  Kanban,
  Filter,
  ArrowUpDown,
  Download,
  Upload,
  MoreVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ObjectPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params.slug;

  const {
    object,
    records,
    total,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    fetchData,
    updateRecord,
    createRecord,
    setRecords,
    filter,
    setFilter,
    sorts,
    setSorts,
    hasFilter,
    hasSort,
    removeFilterCondition,
    clearFilters,
    clearSorts,
  } = useObjectRecords(slug);

  const [view, setView] = useState<"table" | "board">("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Deep-Link aus der Befehlspalette: ?create=1 öffnet das Erstellen-Modal.
  // Danach URL bereinigen, damit ein Reload das Modal nicht erneut öffnet.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreateOpen(true);
      router.replace(`/objects/${slug}`);
    }
  }, [searchParams, router, slug]);

  const handleExport = async () => {
    if (!object || exporting) return;
    let rows = records;
    if (records.length < total) {
      setExporting(true);
      try {
        const all: typeof records = [];
        let pages = 0;
        while (all.length < total && pages < 50) {
          let recData: any;
          if (hasFilter || hasSort) {
            const res = await fetch(`/api/v1/objects/${slug}/records/query`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                limit: 200,
                offset: all.length,
                ...(hasFilter ? { filter } : {}),
                ...(hasSort ? { sorts } : {}),
              }),
            });
            if (res.ok) recData = await res.json();
          } else {
            const res = await fetch(
              `/api/v1/objects/${slug}/records?limit=200&offset=${all.length}`
            );
            if (res.ok) recData = await res.json();
          }
          if (!recData) {
            toast.error("Export fehlgeschlagen", {
              description: "Bitte erneut versuchen",
            });
            return;
          }
          const batch = recData.data.records;
          if (batch.length === 0) break;
          all.push(...batch);
          pages++;
        }
        if (pages >= 50 && all.length < total) {
          toast.warning("Export auf 10000 Zeilen begrenzt");
        }
        rows = all;
      } catch {
        toast.error("Export fehlgeschlagen", {
          description: "Bitte erneut versuchen",
        });
        return;
      } finally {
        setExporting(false);
      }
    }
    const csv = generateCSV(rows, object.attributes as any);
    downloadCSV(csv, `${object.pluralName.toLowerCase()}.csv`);
  };

  // Auto-detect if board view is available (has a status attribute)
  const statusAttr = object?.attributes.find((a) => a.type === "status");
  const hasBoardView = !!statusAttr;

  if (loading && !object) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!object) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Object not found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border px-3 sm:px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{object.pluralName}</h1>
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "record" : "records"}
          </span>
        </div>

        {/* Mobile-only: compact toolbar (overflow menu + New) */}
        <div className="flex items-center gap-2 sm:hidden">
          <Button size="sm" onClick={() => setCreateOpen(true)} className="flex-1">
            <Plus className="mr-1 h-4 w-4" />
            New {object.singularName}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setFilterOpen(true)}>
                <Filter className="h-3.5 w-3.5 mr-2" /> Filter{hasFilter ? ` (${filter.conditions.length})` : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortOpen(true)}>
                <ArrowUpDown className="h-3.5 w-3.5 mr-2" /> Sort{hasSort ? ` (${sorts.length})` : ""}
              </DropdownMenuItem>
              {hasBoardView && (
                <DropdownMenuItem onClick={() => setView(view === "table" ? "board" : "table")}>
                  {view === "table" ? (
                    <><Kanban className="h-3.5 w-3.5 mr-2" /> Board view</>
                  ) : (
                    <><Table2 className="h-3.5 w-3.5 mr-2" /> Table view</>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExport} disabled={exporting}>
                <Download className="h-3.5 w-3.5 mr-2" /> {exporting ? "Exportiere..." : "Export CSV"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-2" /> Import CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fetchData()} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} /> Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Desktop: full toolbar */}
        <div className="hidden sm:flex items-center gap-2">
          {/* Filter button */}
          <Popover
            open={filterOpen}
            onOpenChange={setFilterOpen}
            align="end"
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-xs gap-1",
                  hasFilter && "text-primary"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                Filter
                {hasFilter && (
                  <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">
                    {filter.conditions.length}
                  </span>
                )}
              </Button>
            }
          >
            <FilterBuilder
              attributes={object.attributes as any}
              filter={filter}
              onChange={setFilter}
              onClose={() => setFilterOpen(false)}
            />
          </Popover>

          {/* Sort button */}
          <Popover
            open={sortOpen}
            onOpenChange={setSortOpen}
            align="end"
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-xs gap-1",
                  hasSort && "text-primary"
                )}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort
                {hasSort && (
                  <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">
                    {sorts.length}
                  </span>
                )}
              </Button>
            }
          >
            <SortBuilder
              attributes={object.attributes as any}
              sorts={sorts}
              onChange={setSorts}
              onClose={() => setSortOpen(false)}
            />
          </Popover>

          {/* View toggle */}
          {hasBoardView && (
            <div className="flex items-center rounded-md border border-border">
              <button
                onClick={() => setView("table")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors rounded-l-md",
                  view === "table"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Table2 className="h-3.5 w-3.5" />
                Table
              </button>
              <button
                onClick={() => setView("board")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors rounded-r-md",
                  view === "board"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Kanban className="h-3.5 w-3.5" />
                Board
              </button>
            </div>
          )}

          {/* Import / Export */}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exportiere..." : "Export"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>

          <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New {object.singularName}
          </Button>
        </div>
      </div>

      {/* Active filter bar */}
      {hasFilter && (
        <div className="border-b border-border/50 px-4 py-1.5">
          <FilterBar
            filter={filter}
            attributes={object.attributes as any}
            onRemoveCondition={removeFilterCondition}
            onClearAll={clearFilters}
          />
        </div>
      )}

      {/* Active sort indicator */}
      {hasSort && (
        <div className="border-b border-border/50 px-4 py-1.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sorted by:</span>
          {sorts.map((sort, i) => {
            const attr = object.attributes.find((a) => a.slug === sort.attribute);
            return (
              <span key={i} className="text-xs">
                {i > 0 && <span className="text-muted-foreground mr-1">,</span>}
                <span className="font-medium">{attr?.title ?? sort.attribute}</span>
                <span className="text-muted-foreground ml-1">
                  {sort.direction === "asc" ? "\u2191" : "\u2193"}
                </span>
              </span>
            );
          })}
          <button
            onClick={clearSorts}
            className="text-xs text-muted-foreground hover:text-foreground ml-2"
          >
            Clear
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === "table" ? (
          <RecordTable
            attributes={object.attributes as any}
            records={records}
            onUpdateRecord={updateRecord}
            onCreateRecord={() => setCreateOpen(true)}
            objectSlug={slug}
          />
        ) : (
          <RecordKanban
            attributes={object.attributes as any}
            records={records}
            statusAttributeSlug={statusAttr!.slug}
            onMoveRecord={(recordId, newStatusId) =>
              updateRecord(recordId, statusAttr!.slug, newStatusId)
            }
            onReorder={(orderedIds) => {
              // Optimistic local reorder: sort records in orderedIds
              // into the specified order while keeping all others stable
              const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
              setRecords((prev) =>
                [...prev].sort((a, b) => {
                  const aIdx = orderMap.get(a.id);
                  const bIdx = orderMap.get(b.id);
                  if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
                  return 0;
                })
              );
              // Persist to server
              fetch(`/api/v1/objects/${slug}/records/reorder`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ recordIds: orderedIds }),
              })
                .then((res) => {
                  if (!res.ok) throw new Error();
                })
                .catch(() => {
                  toast.error("Verschieben fehlgeschlagen");
                  fetchData();
                });
            }}
            onClickRecord={(recordId) =>
              router.push(`/objects/${slug}/${recordId}`)
            }
            objectSlug={slug}
          />
        )}
      </div>

      {hasMore && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            Zeige {records.length} von {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Lädt..." : "Mehr laden"}
          </Button>
        </div>
      )}

      {/* Create modal */}
      <RecordCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={createRecord}
        attributes={object.attributes as any}
        objectName={object.singularName}
      />

      {/* Import modal */}
      <CSVImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        objectSlug={slug}
        objectName={object.singularName}
        attributes={object.attributes as any}
        onImportComplete={fetchData}
      />
    </div>
  );
}
