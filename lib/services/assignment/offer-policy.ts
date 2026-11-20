/** One distinct standby per working person. Search avoids wasting the only specialist. */
export function pairQualifiedBackups<T extends { cleanerId: string }>(
  workers: T[], candidates: T[], qualifies: (backup: T, worker: T) => boolean,
): Array<{ worker: T; backup: T }> {
  const pool = candidates.filter(c => !workers.some(w => w.cleanerId === c.cleanerId));
  const matches = new Map<string, { worker: T; backup: T }>();
  function place(worker: T, visited: Set<string>): boolean {
    for (const backup of pool) {
      if (visited.has(backup.cleanerId) || !qualifies(backup, worker)) continue;
      visited.add(backup.cleanerId);
      const previous = matches.get(backup.cleanerId);
      if (!previous || place(previous.worker, visited)) {
        matches.set(backup.cleanerId, { worker, backup });
        return true;
      }
    }
    return false;
  }
  for (const worker of workers) place(worker, new Set());
  return workers.flatMap(worker => [...matches.values()].filter(pair => pair.worker.cleanerId === worker.cleanerId));
}
