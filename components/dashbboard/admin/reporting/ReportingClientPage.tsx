"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";

export function ReportingClientPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/jobs/stats");
      if (!res.ok) throw new Error("Failed to fetch job stats");
      return res.json();
    },
  });

  if (isLoading) return <div>Loading reporting...</div>;
  if (error) return <div>Error loading reporting</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Reporting</h2>
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 border rounded">Total Jobs: {data?.totalJobs}</div>
        <div className="p-4 border rounded">Active: {data?.totalActive}</div>
        <div className="p-4 border rounded">Today: {data?.totalToday}</div>
        <div className="p-4 border rounded">Completed: {data?.totalCompleted}</div>
      </div>
      <div className="mt-4">
        <pre className="text-sm bg-muted p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  );
}
