'use client';

import { getEntryMethod, PETS_CLEANER_NOTE } from '@/lib/constants/service-type';

/**
 * Counterproposal items 6, 7, 12 and 13 — entry method, the actual access
 * details, parking, and the pets note.
 *
 * This component renders credentials. Read the rules before changing it.
 *
 * `entryInstructions` holds door, lockbox, gate and garage codes. It is
 * **admin-only and assigned-cleaner-only**, and every caller must gate it —
 * this component deliberately does NOT know who is looking, because a component
 * that decides its own authorization is a component whose authorization is
 * invisible at the call site. `[slug]` serves the admin dashboard *and* the
 * customer portal off the same pages, so an ungated render here is a
 * credential on a customer's screen.
 *
 * The values are read **live from the property**, never from
 * `jobs.addons_snapshot` — the snapshot is a pricing freeze that the native app
 * reads and that travels through surfaces with no business holding a door code.
 */
export function AccessDetailsPanel({
  entryMethod,
  entryInstructions,
  parkingInstructions,
  petsAllowed,
  className = '',
}: {
  entryMethod: string | null;
  entryInstructions: string | null;
  parkingInstructions: string | null;
  petsAllowed: boolean | null;
  className?: string;
}) {
  const method = getEntryMethod(entryMethod);
  const hasAccessInfo = Boolean(
    method || entryInstructions || parkingInstructions
  );

  return (
    <div className={className}>
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Entry method
          </p>
          <p className="font-medium text-gray-900">
            {method ? method.label : 'Not provided'}
          </p>
        </div>

        {entryInstructions && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Access details
            </p>
            {/* Codes are typed with meaningful line breaks ("Gate 4821, then
                lockbox 0917 on the rail"). `whitespace-pre-wrap` keeps them,
                and `break-words` stops a long unbroken code from widening the
                card past the sidebar. */}
            <p className="whitespace-pre-wrap break-words font-medium text-gray-900">
              {entryInstructions}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Confidential — share only with the cleaner assigned to this clean.
            </p>
          </div>
        )}

        {parkingInstructions && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Parking
            </p>
            <p className="whitespace-pre-wrap break-words font-medium text-gray-900">
              {parkingInstructions}
            </p>
          </div>
        )}

        {!hasAccessInfo && (
          <p className="text-gray-500">
            No entry or parking information on file for this property.
          </p>
        )}

        <div className="border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Pets
          </p>
          <p className="font-medium text-gray-900">
            {petsAllowed ? 'Yes' : 'None reported'}
          </p>
          {/* Item 7's exact string, from one shared constant. */}
          {petsAllowed && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              {PETS_CLEANER_NOTE}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
