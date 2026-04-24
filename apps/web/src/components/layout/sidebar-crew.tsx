"use client";

import { useCallback, useEffect, useState } from "react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

interface Employee {
  id: string;
  name: string;
  photoBase64: string | null;
}

/**
 * Compact crew list shown at the bottom of the expanded sidebar.
 * Pulls the first 5 employees so the user knows at a glance who's around today.
 * The single source of truth is the employees table — no duplicate state.
 */
export function SidebarCrew() {
  const [crew, setCrew] = useState<Employee[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/employees");
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.data ?? []) as Array<{
        id: string;
        name: string;
        photoBase64: string | null;
      }>;
      setCrew(list.slice(0, 5));
    } catch {
      // ignore — sidebar is best-effort
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (crew.length === 0) return null;

  return (
    <div
      className="mt-auto px-2.5 py-3"
      style={{ borderTop: "1px dashed var(--line-strong)" }}
    >
      <div className="k-label mb-2.5" style={{ fontSize: 10 }}>
        Crew heute
      </div>
      <div className="space-y-1">
        {crew.map((c) => (
          <div key={c.id} className="flex items-center gap-2 py-1 text-[13px]">
            <EmployeeAvatar name={c.name} photoBase64={c.photoBase64} size="xs" />
            <span className="truncate flex-1">{c.name}</span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--ok)" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
