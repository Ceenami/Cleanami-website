"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReportingSummary } from "@/lib/queries/reporting";
import {
  DollarSign,
  Wallet,
  PiggyBank,
  TrendingUp,
  ShieldAlert,
  Clock,
  Repeat,
  MapPin,
  Download,
} from "lucide-react";

async function fetchSummary(): Promise<ReportingSummary> {
  const res = await fetch("/api/reporting/summary");
  if (!res.ok) throw new Error("Failed to fetch reporting summary");
  return res.json();
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export function ReportingClientPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reporting", "summary"],
    queryFn: fetchSummary,
  });

  if (isLoading) return <div className="p-4 text-gray-500">Loading reporting…</div>;
  if (error || !data)
    return <div className="p-4 text-red-600">Error loading reporting.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Reporting &amp; Analytics</h2>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/api/reporting/summary?format=csv";
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<DollarSign className="h-5 w-5 text-emerald-600" />} label="Revenue" value={money(data.revenue)} />
        <Kpi icon={<Wallet className="h-5 w-5 text-indigo-600" />} label="Cleaner Payouts" value={money(data.cleanerPayouts)} />
        <Kpi icon={<PiggyBank className="h-5 w-5 text-amber-600" />} label="Reserve Held" value={money(data.reserveHeld)} />
        <Kpi icon={<TrendingUp className="h-5 w-5 text-teal-600" />} label="Margin" value={money(data.margin)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<MapPin className="h-5 w-5 text-sky-600" />} label="Coverage Rate" value={`${data.coverageRate}%`} sub={`${data.jobs.assignedUpcoming}/${data.jobs.upcoming} upcoming assigned`} />
        <Kpi icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} label="Dispute Rate" value={`${data.disputeRate}%`} sub={`${data.jobs.completed} completed cleans`} />
        <Kpi icon={<Clock className="h-5 w-5 text-orange-600" />} label="Late Rate" value={`${data.lateRate}%`} sub="of recorded arrivals" />
        <Kpi icon={<Repeat className="h-5 w-5 text-violet-600" />} label="Retention" value={`${data.retentionRate}%`} sub={`${data.subscriptions.active} active`} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Jobs</h3>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Total" value={data.jobs.total} />
          <Stat label="Completed" value={data.jobs.completed} />
          <Stat label="Canceled" value={data.jobs.canceled} />
          <Stat label="Upcoming" value={data.jobs.upcoming} />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Subscriptions</h3>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Active" value={data.subscriptions.active} />
          <Stat label="Paused" value={data.subscriptions.paused} />
          <Stat label="Canceled" value={data.subscriptions.canceled} />
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-gray-50 p-3">
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
