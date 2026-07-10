"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";

export function FinancialsClientPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["financials", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/financials/summary");
      if (!res.ok) throw new Error("Failed to fetch financials");
      return res.json();
    },
  });

  if (isLoading) return <div>Loading financials...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Financials</h2>
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 border rounded">Total Paid: ${data?.totalPaid}</div>
        <div className="p-4 border rounded">Total Pending: ${data?.totalPending}</div>
        <div className="p-4 border rounded">Payout Count: {data?.count || 0}</div>
      </div>
      <pre className="text-sm bg-muted p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
