/**
 * `jobs.notes` is written by several independent systems — seeding, the
 * pre-authorize cron, capture, and reconciliation — none of which know about the
 * others. Any `.set({ notes: ... })` that assigns rather than appends silently
 * destroys whatever the previous writer recorded, which is how capture failures
 * came to erase reconciliation history.
 *
 * Always append through this helper.
 */
export function appendJobNote(existing: string | null, line: string): string {
  const base = existing?.trim() ?? "";
  return base ? `${base}\n${line}` : line;
}
