"use client";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { CustomerJobListItem } from "@/lib/customer/job-list";
type Page = { data: CustomerJobListItem[]; nextPage: number | null };
export function CustomerJobList() {
  const {
    data,
    isPending,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["customer-job-list"],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<Page> => {
      const r = await fetch(
        `/api/jobs?ownerScope=1&page=${pageParam}&sortByCheckIn=desc`,
      );
      if (!r.ok) throw new Error("Unable to load your schedule");
      return r.json();
    },
    getNextPageParam: (last) => last.nextPage ?? undefined,
  });
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Your cleaning schedule</h1>
      {isPending ? (
        <p>Loading your cleans…</p>
      ) : isError ? (
        <p role="alert">Unable to load your schedule. Refresh to retry.</p>
      ) : (
        <ul>
          {data?.pages
            .flatMap((p) => p.data)
            .map((job) => (
              <li key={job.id} className="border-b py-4">
                <Link
                  className="block text-teal-800 font-medium"
                  href={`/customer/job-oversight/${job.id}`}
                >
                  {job.serviceLabel}
                </Link>
                <p className="text-sm mt-1">{job.address}</p>
                <p className="text-sm text-gray-600">
                  {job.plannedArrival
                    ? new Date(job.plannedArrival).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        timeZoneName: "short",
                      })
                    : "Not scheduled"}{" "}
                  · {job.arrivalWindowLabel} ·{" "}
                  {job.status?.replaceAll("_", " ")}
                </p>
              </li>
            ))}
        </ul>
      )}
      {data?.pages[0].data.length === 0 && <p>No cleans recorded yet.</p>}
      {hasNextPage && (
        <button
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
          className="text-teal-800"
        >
          {isFetchingNextPage ? "Loading…" : "Load more cleans"}
        </button>
      )}
    </section>
  );
}
