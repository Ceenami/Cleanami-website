"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  jobId: string | null;
};

type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
};

export function NotificationsPageClient() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<NotificationsResponse>({
    queryKey: ["notifications", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}/mark-read`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to mark read");
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", "recent"] }),
  });

  const notifications = data?.notifications ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading notifications…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600">
        Could not load notifications. Try refreshing the page.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Notifications</h2>
      {notifications.length === 0 ? (
        <p className="text-sm text-gray-500">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between rounded border p-3 ${
                !n.isRead ? "border-teal-200 bg-teal-50" : ""
              }`}
            >
              <div>
                <div className="font-medium">{n.title}</div>
                <div className="text-sm text-gray-600">{n.message}</div>
                <div className="text-xs text-gray-400">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
              {!n.isRead && (
                <button
                  type="button"
                  onClick={() => markRead.mutate(n.id)}
                  disabled={markRead.isPending}
                  className="text-sm font-medium text-teal-600 hover:underline disabled:opacity-50"
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
