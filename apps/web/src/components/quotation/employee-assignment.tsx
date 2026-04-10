"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, X, Loader2 } from "lucide-react";

interface EmployeeOption {
  id: string;
  name: string;
  hourlyRate: string;
  experience: string | null;
}

interface Assignment {
  id: string;
  employeeId: string;
  role: string;
  employeeName: string;
  hourlyRate: string;
  experience: string | null;
}

interface Props {
  recordId: string;
  onChanged: () => void;
}

export function EmployeeAssignment({ recordId, onChanged }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allEmployees, setAllEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/employees`);
      if (res.ok) {
        const data = await res.json();
        setAssignments(data.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    fetchAssignments();
    fetch("/api/v1/employees")
      .then((r) => r.json())
      .then((d) => setAllEmployees(d.data || []))
      .catch(() => {});
  }, [fetchAssignments]);

  const assignedIds = new Set(assignments.map((a) => a.employeeId));
  const available = allEmployees.filter((e) => !assignedIds.has(e.id));

  async function handleAssign() {
    if (!selectedEmpId) return;
    setAssigning(true);
    try {
      await fetch(`/api/v1/deals/${recordId}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedEmpId }),
      });
      setSelectedEmpId("");
      setShowPicker(false);
      fetchAssignments();
      onChanged();
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemove(assignmentId: string) {
    await fetch(`/api/v1/deals/${recordId}/employees/${assignmentId}`, {
      method: "DELETE",
    });
    fetchAssignments();
    onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Assigned Employees</h3>
        <Button variant="outline" size="sm" onClick={() => setShowPicker(!showPicker)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Assign
        </Button>
      </div>

      {showPicker && (
        <div className="mb-4 rounded-lg border border-border p-3 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Select Employee</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
            >
              <option value="">Choose...</option>
              {available.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({Number(e.hourlyRate).toFixed(2)} EUR/h)
                </option>
              ))}
            </select>
          </div>
          <Button onClick={handleAssign} disabled={!selectedEmpId || assigning} size="sm">
            {assigning && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Add
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPicker(false)}>
            Cancel
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No employees assigned to this contract yet.</p>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {a.employeeName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{a.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {Number(a.hourlyRate).toLocaleString("de-DE", {
                      style: "currency",
                      currency: "EUR",
                    })}
                    /h
                    {a.experience ? ` · ${a.experience}` : ""}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(a.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
