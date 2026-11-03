"use client";

import Link from "next/link";
import type { Route } from "next";
import { useNotificationInbox } from "@/hooks/useNotificationInbox";
import { Loader2 } from "lucide-react";

export function NotificationsPageClient() {
  const { data, isLoading, isError, markRead, refetch } = useNotificationInbox("admin");

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
      <p role="alert" className="text-sm text-red-600">
        Could not load notifications. Try refreshing the page.
        <button type="button" className="ml-2 underline" onClick={() => refetch()}>Retry</button>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Notifications</h2>
      {markRead.isError && <p role="alert" className="text-sm text-red-600">{markRead.error.message}</p>}
      {notifications.length === 0 ? (
        <p className="text-sm text-gray-500">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between rounded border p-3 ${!n.isRead ? "border-teal-200 bg-teal-50" : ""
                }`}
            >
              <div>
                <div className="font-medium">{n.title}</div>
                <div className="text-sm text-gray-600">{n.message}</div>
                <div className="text-xs text-gray-400">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
                {n.url && (
                  <Link
                    href={n.url as Route}
                    className="mt-1 inline-block text-sm font-semibold text-teal-600 hover:underline"
                  >
                    View
                  </Link>
                )}
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
