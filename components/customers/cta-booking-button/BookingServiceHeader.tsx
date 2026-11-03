"use client";

import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/constants/service-type";

export function BookingServiceHeader({ serviceType, onChange, isChanging = false }: {
  serviceType: ServiceType;
  onChange?: () => void;
  isChanging?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-4">
      <p className="text-sm font-semibold text-gray-800">{SERVICE_TYPE_LABELS[serviceType]}</p>
      {onChange && <button type="button" onClick={onChange} disabled={isChanging} aria-busy={isChanging} className="min-h-11 rounded px-2 text-sm font-medium text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-wait disabled:opacity-60">{isChanging ? "Saving progress..." : "Change cleaning type"}</button>}
    </div>
  );
}
