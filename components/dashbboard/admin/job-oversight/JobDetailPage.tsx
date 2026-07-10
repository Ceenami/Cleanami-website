'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { JobDetails } from '@/lib/queries/jobs';
import { JobSummaryHeader } from './JobSummaryHeader';
import { EvidenceReviewSection } from './EvidenceReviewSection';
import { JobHistorySection } from './JobHistorySeciont';
import { PropertyDetailsCard } from './PropertyDetailsCard';
import { CleanerCard } from './CleanerCard';
import { IssuesCard } from './IssuesCard';
import { AdminActionsCard, type AdminConfirmAction } from './AdminActionsCard';
import { EvidenceReviewModal } from './modals/EvidenceReviewModal';
import { ConfirmationModal } from '../ui/ConfirmationModal';
import { useRealtimeCleanerCard } from '@/hooks/useRealtimeCleanerCard';
import { useCurrentUser } from '@/hooks/useCurrentUser';


export function JobDetailsClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const isAdmin =
    user?.user_metadata?.role === "admin" ||
    user?.user_metadata?.role === "super_admin";
  useRealtimeCleanerCard(jobId)
  const { data: job, isLoading } = useQuery<JobDetails>({
    queryKey: ['job-details', jobId],
    queryFn: async () => {  // ✅ Add queryFn
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error('Failed to fetch job details');
      return response.json();
    },
  });

  // Modal states
  const [reviewPhotoIndex, setReviewPhotoIndex] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<AdminConfirmAction | null>(null);

  // Real-time subscription (admin only — uses direct Supabase client)
  useEffect(() => {
    if (!isAdmin) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`job-details-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['job-details', jobId] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs_to_cleaners', filter: `job_id=eq.${jobId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['job-details', jobId] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evidence_packets', filter: `job_id=eq.${jobId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['job-details', jobId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, queryClient, isAdmin]);

  if (isLoading || !job) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading job details...</p>
        </div>
      </div>
    );
  }

  const primaryCleaner = job.cleaners.find(c => c.role === 'primary')?.cleaner;

  return (
    <>
      <div className="space-y-6">
        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="flex items-center text-sm font-semibold text-gray-600 hover:text-gray-900"
        >
          <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to {isAdmin ? "Job Oversight" : "your schedule"}
        </button>

        <JobSummaryHeader job={job} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-2 space-y-6">
            <EvidenceReviewSection
              evidencePacket={job.evidencePacket}
              onReviewPhoto={(index) => setReviewPhotoIndex(index)}
            />
            <JobHistorySection jobId={jobId} />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <CleanerCard
              job={job}
              primaryCleaner={primaryCleaner}
              allCleaners={job.cleaners}
              onAction={(action) => setConfirmAction(action)}
              readOnly={!isAdmin}
            />
            <PropertyDetailsCard property={job.property} />
            <IssuesCard evidencePacket={job.evidencePacket} />
            {isAdmin && (
              <AdminActionsCard
                job={job}
                onAction={(action) => setConfirmAction(action)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {reviewPhotoIndex !== null && job.evidencePacket?.photoUrls && (
        <EvidenceReviewModal
          photoUrls={job.evidencePacket.photoUrls}
          currentIndex={reviewPhotoIndex}
          onClose={() => setReviewPhotoIndex(null)}
        />
      )}

      {confirmAction && (
        <ConfirmationModal
          isOpen={true}
          title={confirmAction.title}
          confirmButtonText={confirmAction.confirmButtonText}
          confirmButtonClassName={confirmAction.confirmButtonClassName}
          loadingText={confirmAction.loadingText}
          onConfirm={confirmAction.onConfirm}
          onClose={() => setConfirmAction(null)}
        >
          {confirmAction.message}
        </ConfirmationModal>
      )}
    </>
  );
}