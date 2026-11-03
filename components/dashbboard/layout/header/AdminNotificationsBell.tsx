"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Bell, Loader2, X } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { useNotificationInbox } from "@/hooks/useNotificationInbox";

export function AdminNotificationsBell() {
  const { data: user } = useCurrentUser();
  const userRole = user?.role as string | undefined;
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  const [open, setOpen] = useState(false);
  const { data, isLoading: initialLoading, isFetching: refreshing, isError, refetch, markRead } =
    useNotificationInbox("admin", isAdmin);
  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  if (!isAdmin) {
    return null;
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          refetch();
        }}
        className="relative text-gray-500 hover:text-gray-700"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-full max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">
                  Notifications
                </h2>
                {refreshing && (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {unreadCount > 0 && (
              <div className="border-b px-4 py-2">
                <button
                  type="button"
                  onClick={() => markRead.mutate(undefined)}
                  disabled={markRead.isPending}
                  className="text-sm font-medium text-teal-600 hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {isError && <p role="alert" className="p-4 text-sm text-red-600">Could not load notifications. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></p>}
              {markRead.isError && <p role="alert" className="p-4 text-sm text-red-600">{markRead.error.message}</p>}
              {initialLoading && notifications.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">Loading…</p>
              ) : notifications.length === 0 && !isError ? (
                <p className="p-4 text-sm text-gray-500">
                  No notifications yet.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      className={cn("px-4 py-3", !n.isRead && "bg-teal-50")}
                    >
                      <p className="text-sm font-semibold text-gray-900">
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-600">
                        {n.message}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {formatTime(n.createdAt)}
                      </p>
                      {n.url && (
                        <Link
                          href={n.url as Route}
                          onClick={() => setOpen(false)}
                          className="mt-1 inline-block text-xs font-semibold text-teal-600 hover:underline"
                        >
                          View
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
