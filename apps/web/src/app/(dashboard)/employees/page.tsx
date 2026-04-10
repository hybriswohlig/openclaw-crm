"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";

interface Employee {
  id: string;
  name: string;
  experience: string | null;
  hourlyRate: string;
  createdAt: string;
  contractCount: number;
}

interface Contract {
  assignmentId: string;
  dealRecordId: string;
  role: string;
  assignedAt: string;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [form, setForm] = useState({ name: "", experience: "", hourlyRate: "" });
  const [saving, setSaving] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  async function handleSave() {
    setSaving(true);
    try {
      const url = editId ? `/api/v1/employees/${editId}` : "/api/v1/employees";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setForm({ name: "", experience: "", hourlyRate: "" });
        fetchEmployees();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this employee?")) return;
    const res = await fetch(`/api/v1/employees/${id}`, { method: "DELETE" });
    if (res.ok) fetchEmployees();
  }

  function startEdit(emp: Employee) {
    setEditId(emp.id);
    setForm({ name: emp.name, experience: emp.experience || "", hourlyRate: emp.hourlyRate });
    setShowForm(true);
  }

  async function toggleExpand(emp: Employee) {
    if (expandedId === emp.id) {
      setExpandedId(null);
      setContracts([]);
      return;
    }
    setExpandedId(emp.id);
    const res = await fetch(`/api/v1/employees/${emp.id}`);
    if (res.ok) {
      const data = await res.json();
      setContracts(data.data?.contracts || []);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Employees</h1>
        <Button
          onClick={() => {
            setEditId(null);
            setForm({ name: "", experience: "", hourlyRate: "" });
            setShowForm(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add Employee
        </Button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-border p-4 space-y-3">
          <h3 className="font-medium text-sm">{editId ? "Edit Employee" : "New Employee"}</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Experience</label>
              <input
                type="text"
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                placeholder="e.g. 5 years, Senior"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Hourly Rate (EUR) *</label>
              <input
                type="number"
                step="0.01"
                value={form.hourlyRate}
                onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !form.name || !form.hourlyRate}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editId ? "Update" : "Create"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setEditId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {employees.length === 0 ? (
        <p className="text-muted-foreground text-sm">No employees yet. Add your first one above.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium w-8" />
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Experience</th>
                <th className="text-right px-4 py-3 font-medium">Hourly Rate</th>
                <th className="text-right px-4 py-3 font-medium">Contracts</th>
                <th className="text-right px-4 py-3 font-medium w-24" />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <>
                  <tr
                    key={emp.id}
                    className="border-b border-border hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggleExpand(emp)}
                  >
                    <td className="px-4 py-3">
                      {expandedId === emp.id ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{emp.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.experience || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {Number(emp.hourlyRate).toLocaleString("de-DE", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">{emp.contractCount}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(emp);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(emp.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === emp.id && (
                    <tr key={`${emp.id}-detail`}>
                      <td colSpan={6} className="bg-muted/20 px-8 py-3">
                        {contracts.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No contracts assigned yet.</p>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs font-medium mb-2">Assigned Contracts ({contracts.length})</p>
                            {contracts.map((c) => (
                              <div key={c.assignmentId} className="flex items-center gap-3 text-xs">
                                <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c.role}</span>
                                <span className="font-mono text-muted-foreground">{c.dealRecordId.slice(0, 8)}...</span>
                                <span className="text-muted-foreground">
                                  {new Date(c.assignedAt).toLocaleDateString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
