"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type InboxNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobId: string | null;
  url?: string | null;
};

type Inbox = { notifications: InboxNotification[]; unreadCount: number };

/** All inbox surfaces share server state and confirm writes before clearing badges. */
export function useNotificationInbox(portal: "admin" | "cleaner", enabled = true) {
  const qc = useQueryClient();
  const queryKey = ["notifications", portal];
  const endpoint = portal === "admin" ? "/api/notifications" : "/api/cleaner/notifications";
  const inbox = useQuery<Inbox>({
    queryKey,
    enabled,
    queryFn: async () => {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("Could not load notifications. Please try again.");
      return response.json();
    },
    refetchInterval: portal === "admin" ? 60_000 : 30_000,
  });
  const markRead = useMutation({
    mutationFn: async (id?: string) => {
      const response = await fetch(id ? `${endpoint}/${id}/mark-read` : endpoint, {
        method: id ? "POST" : "PATCH",
      });
      if (!response.ok) throw new Error("Could not mark notifications read. Please try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  return { ...inbox, markRead };
}
