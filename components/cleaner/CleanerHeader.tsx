"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Bell, Loader2, LogOut, X } from "lucide-react";
import { toast } from "sonner";
import { useSignOut } from "@/hooks/useSignOut";
import { cn } from "@/lib/utils";
import { useNotificationInbox } from "@/hooks/useNotificationInbox";

export function CleanerHeader() {
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const { data, isLoading: initialLoading, isFetching: refreshing, isError, refetch, markRead } =
    useNotificationInbox("cleaner");
  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const [acceptingJobId, setAcceptingJobId] = useState<string | null>(null);

  async function handleAcceptUrgent(jobId: string) {
    setAcceptingJobId(jobId);
    try {
      const response = await fetch(`/api/cleaner/jobs/${jobId}/accept-urgent`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        toast.error(data.error ?? "Could not accept this job");
        await refetch();
        return;
      }

      toast.success(data.message ?? "Urgent job accepted");
      await refetch();
    } catch {
      toast.error("Could not accept this job");
    } finally {
      setAcceptingJobId(null);
    }
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
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-brand">CleanNami</h1>
            <p className="text-xs text-gray-500">Cleaner Portal</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                refetch();
              }}
              className="relative rounded-full p-2 text-gray-600 hover:bg-gray-100"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end">
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
                  className="text-sm font-medium text-brand hover:underline disabled:opacity-50"
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
                <p className="p-4 text-sm text-gray-500">No notifications yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      className={cn(
                        "px-4 py-3",
                        !n.isRead && "bg-brand/5"
                      )}
                    >
                      <p className="text-sm font-semibold text-gray-900">
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-600">{n.message}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {formatTime(n.createdAt)}
                      </p>
                      {n.url && (
                        <Link href={n.url as Route} onClick={() => setOpen(false)} className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">View</Link>
                      )}
                      {n.type === "swap_available" && n.jobId && (
                        <button
                          type="button"
                          onClick={() => handleAcceptUrgent(n.jobId!)}
                          disabled={acceptingJobId === n.jobId}
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                        >
                          {acceptingJobId === n.jobId && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          {acceptingJobId === n.jobId
                            ? "Accepting…"
                            : "Accept urgent job"}
                        </button>
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
