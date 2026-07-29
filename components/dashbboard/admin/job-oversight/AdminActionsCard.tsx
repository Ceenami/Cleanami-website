'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { JobDetails } from '@/lib/queries/jobs';
import type { GetAvailableCleanersForJobResponse } from '@/app/api/jobs/[id]/available-cleaners/route';

export type AdminConfirmAction = {
  title: string;
  message: string;
  loadingText?: string;
  confirmButtonText?: string;
  confirmButtonClassName?: string;
  onConfirm: () => void | Promise<void>;
};

/** Roles an admin can hand out by hand, in the order the spec ranks them. */
const ASSIGNABLE_ROLES = [
  { value: 'primary', label: 'Primary' },
  { value: 'backup', label: 'Backup' },
  { value: 'laundry_lead', label: 'Laundry Lead' },
] as const;

type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]['value'];

export function AdminActionsCard({
  job,
  onAction,
}: {
  job: JobDetails;
  onAction: (action: AdminConfirmAction) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedCleanerId, setSelectedCleanerId] = useState('');
  const [selectedRole, setSelectedRole] = useState<AssignableRole>('primary');
  const [replaceCleanerId, setReplaceCleanerId] = useState('');
  const [newDeadline, setNewDeadline] = useState(
    job.checkInTime ? new Date(job.checkInTime).toISOString().substring(0, 16) : ''
  );

  const isDisabled = job.status === 'canceled' || job.status === 'completed';

  const { data: response, isLoading: loadingCleaners } =
    useQuery<GetAvailableCleanersForJobResponse>({
      queryKey: ['available-cleaners', job.id],
      queryFn: async () => {
        const res = await fetch(
          `/api/jobs/${job.id}/available-cleaners?all=true`
        );
        if (!res.ok) throw new Error('Failed to fetch available cleaners');
        return res.json();
      },
    });

  const availableCleaners = response?.cleaners || [];
  const assignedCleaners = job.cleaners ?? [];

  const roleLabel =
    ASSIGNABLE_ROLES.find((r) => r.value === selectedRole)?.label ?? 'Primary';

  const handleAssign = () => {
    if (!selectedCleanerId) return;

    const selectedCleaner = availableCleaners.find(
      (c) => c.id === selectedCleanerId
    );
    const replaced = assignedCleaners.find(
      (c) => c.cleanerId === replaceCleanerId
    );

    onAction({
      title: `Assign ${roleLabel}`,
      message: replaced
        ? `Swap ${replaced.cleaner.fullName} out and put ${selectedCleaner?.fullName} on this job as ${roleLabel}?`
        : `Assign ${selectedCleaner?.fullName} to this job as ${roleLabel}? Anyone currently holding that role is replaced; the rest of the team is untouched.`,
      loadingText: 'Assigning cleaner…',
      confirmButtonText: 'Assign',
      confirmButtonClassName: 'bg-teal-600 hover:bg-teal-500',
      onConfirm: async () => {
        const response = await fetch(`/api/jobs/${job.id}/reassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cleanerId: selectedCleanerId,
            role: selectedRole,
            replaceCleanerId: replaceCleanerId || undefined,
          }),
        });
        const data = (await response.json()) as {
          error?: string;
          urgentBonus?: boolean;
        };
        if (!response.ok) {
          throw new Error(data.error ?? 'Failed to assign cleaner');
        }
        setSelectedCleanerId('');
        setReplaceCleanerId('');
        await queryClient.invalidateQueries({ queryKey: ['job-details', job.id] });
        await queryClient.invalidateQueries({
          queryKey: ['available-cleaners', job.id],
        });
        toast.success(
          data.urgentBonus
            ? `${roleLabel} assigned with $10 urgent bonus`
            : `${roleLabel} assigned`
        );
      },
    });
  };

  const handleExtendDeadline = () => {
    if (!newDeadline) return;

    onAction({
      title: 'Extend Deadline',
      message: `Extend deadline to ${new Date(newDeadline).toLocaleString()}?`,
      loadingText: 'Updating deadline…',
      confirmButtonText: 'Update',
      confirmButtonClassName: 'bg-teal-600 hover:bg-teal-500',
      onConfirm: async () => {
        const response = await fetch(`/api/jobs/${job.id}/extend-deadline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newDeadline }),
        });
        if (!response.ok) throw new Error('Failed to extend deadline');
        await queryClient.invalidateQueries({ queryKey: ['job-details', job.id] });
        toast.success('Deadline updated');
      },
    });
  };

  const handleUrgentReplacement = () => {
    onAction({
      title: 'Trigger Urgent Replacement',
      message:
        'This removes the primary cleaner. If a backup is assigned, they are promoted automatically with a $10 bonus. Otherwise nearby cleaners are notified first, then on-call/open pool, then all eligible cleaners. You can also assign anyone manually below. Continue?',
      loadingText: 'Processing replacement…',
      confirmButtonText: 'Trigger replacement',
      confirmButtonClassName: 'bg-orange-600 hover:bg-orange-500',
      onConfirm: async () => {
        const response = await fetch(`/api/jobs/${job.id}/urgent-replacement`, {
          method: 'POST',
        });
        const data = (await response.json()) as {
          error?: string;
          outcome?: 'backup_promoted' | 'awaiting_accept';
          replacementCleanerName?: string;
          notifiedCount?: number;
        };
        if (!response.ok) {
          const message =
            data.error ?? 'Failed to trigger urgent replacement';
          toast.error(message);
          throw new Error(message);
        }

        await queryClient.invalidateQueries({ queryKey: ['job-details', job.id] });
        await queryClient.invalidateQueries({
          queryKey: ['available-cleaners', job.id],
        });

        if (data.outcome === 'backup_promoted') {
          toast.success(
            `${data.replacementCleanerName ?? 'Backup cleaner'} promoted to primary with $10 urgent bonus.`
          );
        } else {
          toast.success(
            `Primary removed. ${data.notifiedCount ?? 0} cleaner(s) notified (nearby → on-call/open pool → all eligible). First to accept gets the job, or assign manually below.`
          );
        }
      },
    });
  };

  const handleCancelJob = () => {
    onAction({
      title: 'Cancel Job',
      message:
        'Are you sure you want to cancel this job? This action cannot be undone.',
      loadingText: 'Canceling job…',
      confirmButtonText: 'Cancel job',
      onConfirm: async () => {
        const response = await fetch(`/api/jobs/${job.id}/cancel`, {
          method: 'POST',
        });
        if (!response.ok) throw new Error('Failed to cancel job');
        await queryClient.invalidateQueries({ queryKey: ['job-details', job.id] });
        toast.success('Job canceled');
      },
    });
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg
          className="h-6 w-6 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">
          Admin Overrides
        </h3>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="reassign-cleaner"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Assign Cleaner (all eligible)
          </label>
          {loadingCleaners ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading cleaners…
            </div>
          ) : availableCleaners.length === 0 ? (
            <div className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded">
              No eligible cleaners found. Check job assignments and onboarding.
            </div>
          ) : (
            <div className="space-y-2">
              <select
                id="reassign-cleaner"
                value={selectedCleanerId}
                onChange={(e) => setSelectedCleanerId(e.target.value)}
                disabled={isDisabled}
                className="focus:ring-teal-500 focus:border-teal-500 block w-full rounded-md sm:text-sm border-gray-300 disabled:bg-gray-100"
              >
                <option value="">-- Select Cleaner --</option>
                {availableCleaners.map((cleaner) => (
                  <option key={cleaner.id} value={cleaner.id}>
                    {cleaner.fullName}
                    {cleaner.reliabilityScore &&
                      ` (${cleaner.reliabilityScore}%)`}
                    {cleaner.distance != null
                      ? ` - ${cleaner.distance} mi`
                      : ' - distance n/a'}
                    {cleaner.onCallStatus === 'on_job' && ' - On Job'}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <select
                  aria-label="Role"
                  value={selectedRole}
                  onChange={(e) =>
                    setSelectedRole(e.target.value as AssignableRole)
                  }
                  disabled={isDisabled}
                  className="focus:ring-teal-500 focus:border-teal-500 block w-1/2 rounded-md sm:text-sm border-gray-300 disabled:bg-gray-100"
                >
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>

                {/* Naming who comes off makes this a true swap rather than a
                    blind overwrite of whoever holds the role. */}
                <select
                  aria-label="Replace cleaner"
                  value={replaceCleanerId}
                  onChange={(e) => setReplaceCleanerId(e.target.value)}
                  disabled={isDisabled || assignedCleaners.length === 0}
                  className="focus:ring-teal-500 focus:border-teal-500 block w-1/2 rounded-md sm:text-sm border-gray-300 disabled:bg-gray-100"
                >
                  <option value="">Replace: role holder</option>
                  {assignedCleaners.map((assignment) => (
                    <option
                      key={assignment.cleanerId}
                      value={assignment.cleanerId}
                    >
                      Replace: {assignment.cleaner.fullName} ({assignment.role})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleAssign}
                disabled={isDisabled || !selectedCleanerId}
                className="w-full text-center py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Assign as {roleLabel}
              </button>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="extend-deadline"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Extend Deadline
          </label>
          <div className="flex rounded-md shadow-sm">
            <input
              type="datetime-local"
              id="extend-deadline"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              disabled={isDisabled}
              className="flex-1 focus:ring-teal-500 focus:border-teal-500 block w-full rounded-l-md sm:text-sm border-gray-300 disabled:bg-gray-100"
            />
            <button
              onClick={handleExtendDeadline}
              disabled={isDisabled || !newDeadline}
              className="-ml-px relative inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-r-md text-gray-700 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Update
            </button>
          </div>
        </div>

        <button
          onClick={handleUrgentReplacement}
          disabled={isDisabled}
          className="w-full text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Trigger Urgent Replacement
        </button>

        <div className="pt-2 border-t">
          <button
            onClick={handleCancelJob}
            disabled={isDisabled}
            className="w-full flex items-center justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="h-5 w-5 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Cancel Job
          </button>
        </div>
      </div>
    </div>
  );
}
