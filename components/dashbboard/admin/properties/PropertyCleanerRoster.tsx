"use client";

import { useEffect, useState } from "react";
import { Card } from "./Card";
import { UsersIcon, Trash2 } from "lucide-react";

type Tier =
  | "main_primary"
  | "secondary_primary"
  | "preferred_backup"
  | "on_call";

const TIER_LABELS: Record<Tier, string> = {
  main_primary: "Main Primary",
  secondary_primary: "Secondary Primary",
  preferred_backup: "Preferred Backup",
  on_call: "On-Call",
};

const TIER_ORDER: Tier[] = [
  "main_primary",
  "secondary_primary",
  "preferred_backup",
  "on_call",
];

type RosterEntry = { cleanerId: string; cleanerName: string | null; tier: Tier };
type CleanerOption = { id: string; fullName: string };

export const PropertyCleanerRoster = ({
  propertyId,
}: {
  propertyId: string;
}) => {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [cleaners, setCleaners] = useState<CleanerOption[]>([]);
  const [addCleanerId, setAddCleanerId] = useState("");
  const [addTier, setAddTier] = useState<Tier>("main_primary");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [rosterRes, cleanersRes] = await Promise.all([
          fetch(`/api/properties/${propertyId}/cleaners`),
          fetch(`/api/cleaners?limit=50`),
        ]);
        const rosterBody = await rosterRes.json();
        const cleanersBody = await cleanersRes.json();
        if (!active) return;
        setRoster(rosterBody.roster ?? []);
        setCleaners(
          (cleanersBody.data ?? []).map(
            (c: { id: string; fullName: string }) => ({
              id: c.id,
              fullName: c.fullName,
            })
          )
        );
      } catch {
        if (active) setError("Failed to load roster.");
      }
    })();
    return () => {
      active = false;
    };
  }, [propertyId]);

  const addEntry = () => {
    if (!addCleanerId) return;
    if (roster.some((r) => r.cleanerId === addCleanerId)) return;
    const cleaner = cleaners.find((c) => c.id === addCleanerId);
    setRoster([
      ...roster,
      {
        cleanerId: addCleanerId,
        cleanerName: cleaner?.fullName ?? null,
        tier: addTier,
      },
    ]);
    setAddCleanerId("");
  };

  const removeEntry = (cleanerId: string) =>
    setRoster(roster.filter((r) => r.cleanerId !== cleanerId));

  const changeTier = (cleanerId: string, tier: Tier) =>
    setRoster(
      roster.map((r) => (r.cleanerId === cleanerId ? { ...r, tier } : r))
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Persist in tier priority order so sortOrder reflects the hierarchy.
      const ordered = [...roster].sort(
        (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
      );
      const res = await fetch(`/api/properties/${propertyId}/cleaners`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: ordered.map((r, idx) => ({
            cleanerId: r.cleanerId,
            tier: r.tier,
            sortOrder: idx,
          })),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Failed to save roster");
      }
      setMessage("Cleaner hierarchy saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save roster");
    } finally {
      setSaving(false);
    }
  };

  const availableToAdd = cleaners.filter(
    (c) => !roster.some((r) => r.cleanerId === c.id)
  );

  return (
    <Card icon={<UsersIcon />} title="Cleaner Hierarchy">
      <p className="mb-3 text-sm text-gray-500">
        Preferred cleaners for this property. The assignment engine tries these
        in order (Main Primary first) before falling back to the nearest
        reliable cleaner.
      </p>

      <div className="space-y-2">
        {roster.length === 0 && (
          <p className="text-sm text-gray-400">
            No preferred cleaners set for this property.
          </p>
        )}
        {roster.map((r) => (
          <div
            key={r.cleanerId}
            className="flex items-center gap-2 rounded border border-gray-200 p-2"
          >
            <span className="flex-1 text-sm text-gray-800">
              {r.cleanerName ?? r.cleanerId}
            </span>
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={r.tier}
              onChange={(e) => changeTier(r.cleanerId, e.target.value as Tier)}
            >
              {TIER_ORDER.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeEntry(r.cleanerId)}
              className="text-gray-400 hover:text-red-600"
              title="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <select
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          value={addCleanerId}
          onChange={(e) => setAddCleanerId(e.target.value)}
        >
          <option value="">Add a cleaner…</option>
          {availableToAdd.map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={addTier}
          onChange={(e) => setAddTier(e.target.value as Tier)}
        >
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addEntry}
          disabled={!addCleanerId}
          className="rounded bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-3 text-sm text-green-600">{message}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 w-full rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {saving ? "Saving…" : "Save Hierarchy"}
      </button>
    </Card>
  );
};
