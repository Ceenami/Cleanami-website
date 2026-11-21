/** Several booking buttons can be mounted on one page. Consume the URL signal
 * synchronously so only one opens the saved booking before session I/O ends. */
export function claimBookingResume(
  sessionId: string,
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "state" | "replaceState"> = window.history,
) {
  const url = new URL(location.href);
  if (url.searchParams.get("resume") !== sessionId) return false;
  url.searchParams.delete("resume");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  return true;
}
