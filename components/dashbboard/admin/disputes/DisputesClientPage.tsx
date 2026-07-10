"use client";
import React from "react";
import { refundRequests } from "@/data/adminMockData";

export function DisputesClientPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Disputes & Refunds</h2>
      <div className="space-y-2">
        {refundRequests.map((r) => (
          <div key={r.id} className="p-3 border rounded flex justify-between">
            <div>
              <div className="font-medium">{r.id} — ${r.requestedAmount}</div>
              <div className="text-sm text-muted-foreground">{r.reason}</div>
              <div className="text-xs text-muted-foreground">{r.requestDate}</div>
            </div>
            <div className="space-x-2">
              <button className="btn">Approve</button>
              <button className="btn btn-outline">Deny</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
