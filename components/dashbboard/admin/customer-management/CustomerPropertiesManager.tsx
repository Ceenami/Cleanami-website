"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerDetails } from "@/lib/queries/customers";

type PropertyRow = CustomerDetails["properties"][number];

type CustomerPropertiesManagerProps = {
  properties: PropertyRow[];
};

type MergeFailure = {
  sourcePropertyId: string;
  message: string;
  canDelete: boolean;
};

export function CustomerPropertiesManager({
  properties = [],
}: CustomerPropertiesManagerProps) {
  const router = useRouter();
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeFailure, setMergeFailure] = useState<MergeFailure | null>(null);

  if (properties.length === 0) {
    return <p className="text-sm text-gray-500">No properties found.</p>;
  }

  async function handleMerge(sourcePropertyId: string) {
    if (!targetId) {
      setError("Choose the property to keep.");
      return;
    }

    setSaving(true);
    setError(null);
    setMergeFailure(null);

    try {
      const response = await fetch("/api/properties/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePropertyId,
          targetPropertyId: targetId,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        canDelete?: boolean;
        code?: string;
      };

      if (!response.ok) {
        const message =
          data.error ??
          "We couldn't merge these properties. Please try again or delete the duplicate instead.";
        setMergeFailure({
          sourcePropertyId,
          message,
          canDelete: data.canDelete ?? true,
        });
        setError(message);
        return;
      }

      setMergingId(null);
      setTargetId("");
      router.refresh();
    } catch {
      const message =
        "Something went wrong while merging. Check your connection and try again, or delete the duplicate property instead.";
      setMergeFailure({
        sourcePropertyId,
        message,
        canDelete: true,
      });
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(propertyId: string, address: string) {
    const confirmed = window.confirm(
      `Delete "${address}"?\n\nOnly use this for empty duplicate records with no cleaning history. This cannot be undone.`
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMergeFailure(null);

    try {
      const response = await fetch(`/api/properties/${propertyId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          data.error ??
            "This property can't be deleted because it still has jobs or an active subscription. Merge it into the correct address instead."
        );
      }

      setMergingId(null);
      setTargetId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {properties.length > 1 && (
        <p className="text-xs text-gray-500">
          Duplicate property? Merge the wrong record into the correct one so job
          history and subscriptions move over. If the duplicate has no cleaning
          history, you can delete it instead.
        </p>
      )}

      <ul className="space-y-3">
        {properties.map((property) => {
          const otherProperties = properties.filter((p) => p.id !== property.id);
          const isMerging = mergingId === property.id;
          const failedThisProperty =
            mergeFailure?.sourcePropertyId === property.id;

          return (
            <li
              key={property.id}
              className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700"
            >
              <p className="font-medium text-gray-900">{property.address}</p>
              <p className="mt-1 text-xs text-gray-500 font-mono">{property.id}</p>

              {properties.length > 1 && !isMerging && (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMergingId(property.id);
                      setTargetId("");
                      setError(null);
                      setMergeFailure(null);
                    }}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                  >
                    Merge this duplicate away…
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(property.id, property.address)}
                    disabled={saving}
                    className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Delete property…
                  </button>
                </div>
              )}

              {isMerging && (
                <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
                  <p className="text-xs text-gray-600">
                    This property will be removed. Choose which record to keep:
                  </p>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  >
                    <option value="">Select property to keep</option>
                    {otherProperties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.address}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleMerge(property.id)}
                      className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {saving ? "Merging…" : "Confirm merge"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setMergingId(null);
                        setTargetId("");
                        setError(null);
                        setMergeFailure(null);
                      }}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>

                  {failedThisProperty && mergeFailure.canDelete && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <p>{mergeFailure.message}</p>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          handleDelete(property.id, property.address)
                        }
                        className="mt-2 font-semibold text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        Delete this duplicate instead
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && !mergeFailure && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
