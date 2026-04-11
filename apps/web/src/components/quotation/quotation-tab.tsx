"use client";

import { useState, useEffect, useCallback } from "react";
import { QuotationCalculator } from "./quotation-calculator";
import { EmployeeAssignment } from "./employee-assignment";
import { Loader2 } from "lucide-react";

interface LineItem {
  id?: string;
  type: "helper" | "transporter" | "other";
  description: string;
  quantity: number;
  unitRate: string;
  sortOrder: number;
}

interface Quotation {
  id: string;
  fixedPrice: string | null;
  isVariable: boolean;
  notes: string | null;
  lineItems: LineItem[];
}

export function QuotationTab({ recordId }: { recordId: string }) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/quotation`);
      if (res.ok) {
        const d = await res.json();
        setQuotation(d.data);
      }
    } finally {
      setLoading(false);
    }
  }, [recordId, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <QuotationCalculator
        recordId={recordId}
        quotation={quotation}
        onSaved={refresh}
      />
      <div className="border-t border-border pt-6">
        <EmployeeAssignment recordId={recordId} onChanged={refresh} />
      </div>
    </div>
  );
}
