"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import type { AttributeType } from "@openclaw-crm/shared";
import { AttributeCell } from "./attribute-cell";
import { AttributeEditor } from "./attribute-editor";
import { cn } from "@/lib/utils";
import { Plus, ExternalLink, MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ───────────────────────────────────────────────────────────

interface AttributeDef {
  id: string;
  slug: string;
  title: string;
  type: AttributeType;
  isMultiselect: boolean;
  options?: { id: string; title: string; color: string }[];
  statuses?: { id: string; title: string; color: string; isActive: boolean }[];
}

interface RecordRow {
  id: string;
  values: Record<string, unknown>;
}

interface RecordTableProps {
  attributes: AttributeDef[];
  records: RecordRow[];
  onUpdateRecord: (recordId: string, slug: string, value: unknown) => void;
  onCreateRecord: () => void;
  objectSlug: string;
}

// ─── Component ───────────────────────────────────────────────────────

export function RecordTable({
  attributes,
  records,
  onUpdateRecord,
  onCreateRecord,
  objectSlug,
}: RecordTableProps) {
  const router = useRouter();
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [startingChatFor, setStartingChatFor] = useState<string | null>(null);

  const startWhatsAppChat = useCallback(
    async (recordId: string) => {
      setStartingChatFor(recordId);
      try {
        const res = await fetch(
          "/api/v1/inbox/whatsapp/start-from-record",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recordId }),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            typeof json.error === "object"
              ? json.error.message
              : json.error ?? "Konnte WhatsApp-Chat nicht starten";
          window.alert(msg);
          return;
        }
        const data = json.data as
          | { mode: "open"; conversationId: string }
          | {
              mode: "compose";
              channelAccountId: string;
              toPhone: string;
              customerName: string;
              dealRecordId: string;
            };
        if (data.mode === "open") {
          router.push(`/inbox?conv=${encodeURIComponent(data.conversationId)}`);
        } else {
          const q = new URLSearchParams({
            compose: "1",
            channelAccountId: data.channelAccountId,
            phone: data.toPhone,
            name: data.customerName,
            dealRecordId: data.dealRecordId,
          });
          router.push(`/inbox?${q.toString()}`);
        }
      } finally {
        setStartingChatFor(null);
      }
    },
    [router]
  );

  const columns = useMemo<ColumnDef<RecordRow>[]>(() => {
    // Open button column
    const openCol: ColumnDef<RecordRow> = {
      id: "_open",
      header: "",
      size: objectSlug === "deals" ? 64 : 40,
      cell: ({ row }) => (
        <div className="flex items-center justify-center gap-1">
          {objectSlug === "deals" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void startWhatsAppChat(row.original.id);
              }}
              disabled={startingChatFor === row.original.id}
              className="flex items-center justify-center opacity-0 group-hover/row:opacity-100 disabled:opacity-100 transition-opacity text-[#128C4F] hover:text-[#0e6f3f] disabled:text-muted-foreground"
              title="WhatsApp-Chat starten"
            >
              {startingChatFor === row.original.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageCircle className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            onClick={() => router.push(`/objects/${objectSlug}/${row.original.id}`)}
            className="flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      ),
    };

    const attrCols: ColumnDef<RecordRow>[] = attributes.map((attr) => ({
      id: attr.slug,
      header: attr.title,
      size: attr.type === "personal_name" ? 200 : attr.type === "text" ? 180 : 150,
      cell: ({ row }: { row: { original: RecordRow; id: string } }) => {
        const val = row.original.values[attr.slug];
        const isEditing =
          editingCell?.rowId === row.original.id &&
          editingCell?.colId === attr.slug;

        if (isEditing) {
          return (
            <div className="relative">
              <AttributeEditor
                type={attr.type}
                value={val}
                options={attr.options}
                statuses={attr.statuses}
                onSave={(newVal) => {
                  onUpdateRecord(row.original.id, attr.slug, newVal);
                  setEditingCell(null);
                }}
                onCancel={() => setEditingCell(null)}
              />
            </div>
          );
        }

        return (
          <div
            className="cursor-pointer truncate px-1"
            onClick={() =>
              setEditingCell({ rowId: row.original.id, colId: attr.slug })
            }
          >
            <AttributeCell
              type={attr.type}
              value={val}
              options={attr.options}
              statuses={attr.statuses}
            />
          </div>
        );
      },
    }));

    return [openCol, ...attrCols];
  }, [attributes, editingCell, onUpdateRecord, objectSlug, router, startWhatsAppChat, startingChatFor]);

  const table = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="h-9 px-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="group/row border-b border-border/50 hover:bg-muted/30 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="h-10 px-3 text-sm"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td
                  colSpan={attributes.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  No records yet. Click the button below to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add record row */}
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreateRecord}
          className="text-muted-foreground hover:text-foreground"
        >
          <Plus className="mr-1 h-4 w-4" />
          New record
        </Button>
      </div>
    </div>
  );
}
