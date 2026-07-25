'use client';

import { useState } from 'react';
import { ChevronDownIcon, ChevronsUpDown, ChevronUpIcon, UserIcon } from "lucide-react";
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CleanersResponse } from "@/lib/queries/cleaners";
import { formatContactValue } from "@/components/dashbboard/admin/ui/formatContact";
import { formatDate } from "date-fns";
import { cn } from "@/lib/utils";

type Cleaner = CleanersResponse['data'][number];

const getStatusBadge = (status: string | null | undefined) => {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-800';
    case 'stripe_pending': return 'bg-indigo-100 text-indigo-800';
    case 'onboarding_in_progress': return 'bg-yellow-100 text-yellow-800';
    case 'suspended': return 'bg-red-100 text-red-800';
    case 'available': return 'bg-green-100 text-green-800';
    case 'on_job': return 'bg-blue-100 text-blue-800';
    case 'unavailable': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

function assignmentEligibilityLabel(cleaner: Cleaner): string {
  if (!cleaner.eligibleForAssignments) return 'Off';
  if (cleaner.onboardingCompleted && cleaner.stripePayoutsEnabled) {
    return 'On (ready)';
  }
  return 'On (override)';
}

export type SortDirection = 'ascending' | 'descending';
export type SortableKey = 'fullName' | 'email' | 'phone' | 'accountStatus' | 'createdAt';

export interface SortConfig {
  key: SortableKey;
  direction: SortDirection;
}

interface CleanersTableProps {
  cleaners: Cleaner[];
  sortConfig: SortConfig | null;
  onSort: (key: SortableKey) => void;
  onManageCleaner: (cleaner: Cleaner) => void;
}

/**
 * A single admin-controlled boolean on a cleaner row. Patches one field on
 * `PATCH /api/cleaners/[id]` and refreshes the table.
 */
function CleanerFlagToggle({
  cleaner,
  field,
  enabled,
  label,
  onMessage,
  size = 'md',
}: {
  cleaner: Cleaner;
  field: 'eligibleForAssignments' | 'hasHotTubCert' | 'hasLaundryLeadCert';
  enabled: boolean;
  label: string;
  onMessage: (next: boolean) => string;
  size?: 'sm' | 'md';
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  async function handleToggle() {
    setSaving(true);
    try {
      const response = await fetch(`/api/cleaners/${cleaner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: !enabled }),
      });

      if (!response.ok) {
        throw new Error('Request failed');
      }

      await queryClient.invalidateQueries({ queryKey: ['cleaners'] });
      toast.success(onMessage(!enabled));
    } catch {
      toast.error(`Could not update ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  const small = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={saving}
      onClick={handleToggle}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        small ? 'h-5 w-9' : 'h-6 w-11',
        enabled ? 'bg-teal-600' : 'bg-gray-300'
      )}
    >
      <span
        className={cn(
          'inline-block transform rounded-full bg-white transition-transform',
          small ? 'h-3 w-3' : 'h-4 w-4',
          enabled
            ? small
              ? 'translate-x-5'
              : 'translate-x-6'
            : 'translate-x-1'
        )}
      />
    </button>
  );
}

function AssignmentEligibilityToggle({ cleaner }: { cleaner: Cleaner }) {
  return (
    <div className="flex flex-col gap-1">
      <CleanerFlagToggle
        cleaner={cleaner}
        field="eligibleForAssignments"
        enabled={cleaner.eligibleForAssignments === true}
        label="Assignment eligibility"
        onMessage={(next) =>
          next
            ? `${cleaner.fullName} can now receive job assignments`
            : `${cleaner.fullName} removed from job assignments`
        }
      />
      <span className="text-xs text-gray-500">{assignmentEligibilityLabel(cleaner)}</span>
    </div>
  );
}

/**
 * Hot tub + Laundry Lead certifications. Both gate the assignment engine:
 * a hot-tub job will not be offered to a cleaner without the hot-tub cert, and
 * the off-site Laundry Lead role prefers a laundry-lead-certified team member,
 * falling back to the Team Leader when nobody on the team holds it.
 */
function CertificationsCell({ cleaner }: { cleaner: Cleaner }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <CleanerFlagToggle
          cleaner={cleaner}
          field="hasHotTubCert"
          enabled={cleaner.hasHotTubCert === true}
          label="Hot tub certification"
          size="sm"
          onMessage={(next) =>
            next
              ? `${cleaner.fullName} is now hot-tub certified`
              : `Hot-tub certification removed from ${cleaner.fullName}`
          }
        />
        <span className="text-xs text-gray-600">Hot tub</span>
      </div>
      <div className="flex items-center gap-2">
        <CleanerFlagToggle
          cleaner={cleaner}
          field="hasLaundryLeadCert"
          enabled={cleaner.hasLaundryLeadCert === true}
          label="Laundry Lead certification"
          size="sm"
          onMessage={(next) =>
            next
              ? `${cleaner.fullName} can now be assigned as Laundry Lead`
              : `Laundry Lead certification removed from ${cleaner.fullName}`
          }
        />
        <span className="text-xs text-gray-600">Laundry Lead</span>
      </div>
    </div>
  );
}

export const CleanersTable = ({ cleaners, sortConfig, onSort }: CleanersTableProps) => {
  const headers: { key: SortableKey; label: string }[] = [
    { key: 'fullName', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'accountStatus', label: 'Status' },
    { key: 'createdAt', label: 'Joined' },
  ];

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {headers.map((header) => (
                <th
                  key={header.key}
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  <button
                    onClick={() => onSort(header.key)}
                    className="flex items-center group focus:outline-none"
                  >
                    {header.label}
                    <span className="ml-2">
                      {sortConfig?.key === header.key ? (
                        sortConfig.direction === "ascending" ? (
                          <ChevronUpIcon className="h-4 w-4" />
                        ) : (
                          <ChevronDownIcon className="h-4 w-4" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Job assignments
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Certifications
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Onboarding
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Stripe
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reliability
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {cleaners.map((cleaner) => (
              <tr key={cleaner.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <UserIcon className="h-6 w-6 text-gray-500" />
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">
                        {cleaner.fullName}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {formatContactValue(cleaner.email)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {formatContactValue(cleaner.phone)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(
                      cleaner.accountStatus
                    )}`}
                  >
                    {cleaner.accountStatus?.replaceAll('_', ' ') || 'N/A'}
                  </span>
                </td>
                 <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(cleaner.createdAt, 'yyyy-MM-dd')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <AssignmentEligibilityToggle cleaner={cleaner} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <CertificationsCell cleaner={cleaner} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {cleaner.onboardingCompleted ? 'Complete' : cleaner.onboardingStarted ? 'In progress' : 'Not started'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-600">
                  <div>Payouts: {cleaner.stripePayoutsEnabled ? 'Yes' : 'No'}</div>
                  <div className="text-gray-400 truncate max-w-[140px]">
                    {cleaner.stripeAccountId ?? '—'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {cleaner.reliabilityScore ? `${cleaner.reliabilityScore}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
