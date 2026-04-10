"use client";

import { useState, useEffect, useCallback } from "react";
import { QuotationCalculator } from "./quotation-calculator";
import { EmployeeAssignment } from "./employee-assignment";
import { ProfitSummary } from "./profit-summary";
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

interface ProfitData {
  revenue: number;
  expenses: { employees: Array<{ name: string; hourlyRate: number; estimatedHours: number; cost: number }>; total: number };
  profit: number;
}

export function QuotationTab({ recordId }: { recordId: string }) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [profit, setProfit] = useState<ProfitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, pRes] = await Promise.all([
        fetch(`/api/v1/deals/${recordId}/quotation`),
        fetch(`/api/v1/deals/${recordId}/profit`),
      ]);
      if (qRes.ok) {
        const d = await qRes.json();
        setQuotation(d.data);
      }
      if (pRes.ok) {
        const d = await pRes.json();
        setProfit(d.data);
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

      {profit && (
        <div className="border-t border-border pt-6">
          <ProfitSummary profit={profit} />
        </div>
      )}
    </div>
  );
}
