/**
 * Instant navigation feedback for every dashboard tab.
 *
 * Dashboard pages render their data on the server, so a tab click used to sit
 * on the previous page with no visible response until the whole page had been
 * rendered and streamed — on a phone that reads as "the tab does not work".
 * This Suspense fallback swaps in immediately on click.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-52 rounded-md bg-gray-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-gray-200" />
        ))}
      </div>
      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
