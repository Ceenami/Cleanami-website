"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import {
  restockPropertyUrl,
  type RestockSummary,
} from "@/lib/restocking/types";
import {
  fetchRestocking,
  restockDate,
  restockFocus,
  restockLink,
} from "./RestockRequestsPanel";

export function RestockingClientPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ["restocking", "properties", search, includeResolved, page],
    queryFn: () =>
      fetchRestocking<RestockSummary>(
        new URLSearchParams({
          query: search,
          page: String(page),
          includeResolved: includeResolved ? "1" : "0",
        }),
      ),
    staleTime: 0,
    refetchInterval: 30000,
  });
  const data = result.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <form
          className="flex min-w-0 flex-1 gap-2 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
            setPage(1);
          }}
        >
          <label htmlFor="restock-search" className="sr-only">
            Search property address
          </label>
          <input
            id="restock-search"
            type="search"
            maxLength={120}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search property address"
            className={`min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm ${restockFocus}`}
          />
          <button
            type="submit"
            className={`rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 ${restockFocus}`}
          >
            Search
          </button>
        </form>
        <label className="flex min-h-10 items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => {
              setIncludeResolved(e.target.checked);
              setPage(1);
            }}
            className="accent-teal-700"
          />
          Include resolved properties
        </label>
      </div>
      <p aria-live="polite" className="text-sm text-gray-600">
        {data ? (
          <>
            <strong className="text-lg text-gray-900">
              {data.totals.openCount} open
            </strong>{" "}
            across {data.totals.propertyCount} properties ·{" "}
            {data.totals.urgentCount} urgent
            {search ? " matching your search" : ""}
          </>
        ) : (
          "Loading property counts…"
        )}
      </p>
      {result.isError ? (
        <div role="alert" className="text-sm text-red-700">
          Could not load properties.{" "}
          <button
            type="button"
            onClick={() => result.refetch()}
            className={restockLink}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <caption className="sr-only">
              Restocking requests grouped by property. Open a property to view
              individual requests.
            </caption>
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                {["Property", "Open requests", "Urgent", "Latest request"].map(
                  (h) => (
                    <th key={h} scope="col" className="px-4 py-3">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {result.isPending ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-gray-500">
                    Loading properties…
                  </td>
                </tr>
              ) : !data?.properties.length ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-gray-500">
                    {search
                      ? "No properties match this search."
                      : includeResolved
                        ? "No restocking requests yet."
                        : "No open restocking requests. Include resolved properties to view history."}
                  </td>
                </tr>
              ) : (
                data.properties.map((property) => (
                  <tr key={property.propertyId} className="hover:bg-gray-50">
                    <th
                      scope="row"
                      className="min-w-52 max-w-md px-4 py-5 font-normal"
                    >
                      <Link
                        href={restockPropertyUrl(property.propertyId) as Route}
                        className={restockLink}
                      >
                        {property.address}
                      </Link>
                      <p className="mt-1 text-xs text-gray-500">
                        {property.totalCount} total requests
                      </p>
                    </th>
                    <td className="px-4 py-5 font-semibold text-gray-900">
                      {property.openCount}
                    </td>
                    <td
                      className={`px-4 py-5 ${property.urgentCount ? "font-semibold text-red-700" : "text-gray-500"}`}
                    >
                      {property.urgentCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 text-gray-600">
                      {restockDate(property.latestRequestAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <nav
        aria-label="Property pages"
        className="flex items-center gap-4 text-sm"
      >
        <button
          type="button"
          disabled={page === 1 || result.isFetching}
          onClick={() => setPage((p) => p - 1)}
          className={`min-h-10 rounded-md border border-gray-300 px-4 disabled:opacity-40 ${restockFocus}`}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          disabled={!data?.hasMore || result.isFetching}
          onClick={() => setPage((p) => p + 1)}
          className={`min-h-10 rounded-md border border-gray-300 px-4 disabled:opacity-40 ${restockFocus}`}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
