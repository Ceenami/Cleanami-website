"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

/** Router refresh alone leaves previously viewed schedules fresh in React Query. */
export function usePropertyScheduleRefresh() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return () => {
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        [
          "properties",
          "jobs",
          "job-details",
          "jobs-calendar",
          "cleaner-staffing",
          "job-oversight",
        ].includes(String(queryKey[0])),
      // Mark inactive screens stale; let each screen fetch when opened again.
      refetchType: "none",
    });
    router.refresh();
  };
}
