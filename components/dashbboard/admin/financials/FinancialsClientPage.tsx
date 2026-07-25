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

  if (isLoading) return <div className="p-4 text-gray-500">Loading financials…</div>;

  const money = (v: unknown) =>
    Number(v ?? 0).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
    });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Financials</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Paid</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{money(data?.totalPaid)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{money(data?.totalPending)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Held</p>
          <p className="mt-2 text-2xl font-bold text-gray-700">{money(data?.totalHeld)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Payouts</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{data?.count || 0}</p>
        </div>
      </div>
    </div>
  );
}
