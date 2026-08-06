'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { JobDetails } from '@/lib/queries/jobs';
import { JobSummaryHeader } from './JobSummaryHeader';
import { EvidenceReviewSection } from './EvidenceReviewSection';
import {
  EvidencePhotoGallery,
  flattenGalleryPhotos,
} from './EvidencePhotoGallery';
import { JobHistorySection } from './JobHistorySeciont';
import { PropertyDetailsCard } from './PropertyDetailsCard';
import { CleanerCard } from './CleanerCard';
import { IssuesCard } from './IssuesCard';
import { AdminActionsCard, type AdminConfirmAction } from './AdminActionsCard';
import { EvidenceReviewModal } from './modals/EvidenceReviewModal';
import { ConfirmationModal } from '../ui/ConfirmationModal';
import { useRealtimeCleanerCard } from '@/hooks/useRealtimeCleanerCard';


export function JobDetailsClient({
  jobId,
  isAdmin,
}: {
  jobId: string;
  /**
   * Resolved on the server from `users.role`, and passed in.
   *
   * This used to be read from `user.user_metadata.role` on the client, which
   * `lib/auth/server-roles.ts` is explicit about: user_metadata is editable by
   * the user it belongs to and is never authoritative. A customer could set it
   * and unlock the admin actions card.
   */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
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
  const galleryPhotos = flattenGalleryPhotos(job.evidencePacket?.roomGroups);

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
            <EvidencePhotoGallery
              roomGroups={job.evidencePacket?.roomGroups}
              onOpenPhoto={setGalleryIndex}
              emptyMessage={
                isAdmin
                  ? 'No photos have been submitted for this job yet.'
                  : "Photos will appear here once your cleaner has finished and submitted them."
              }
            />
            <EvidenceReviewSection evidencePacket={job.evidencePacket} />
            {/* Internal workflow trail — not customer-facing. */}
            {isAdmin && <JobHistorySection jobId={jobId} />}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <CleanerCard
              job={job}
              primaryCleaner={primaryCleaner}
              allCleaners={job.cleaners}
              onAction={(action) => setConfirmAction(action)}
              readOnly={!isAdmin}
              showInternals={isAdmin}
            />
            <PropertyDetailsCard property={job.property} />
            {/* Evidence-workflow states ("pending admin review", "packet
                incomplete") are internal process language. */}
            {isAdmin && <IssuesCard evidencePacket={job.evidencePacket} />}
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
      {galleryIndex !== null && galleryPhotos.length > 0 && (
        <EvidenceReviewModal
          photoUrls={galleryPhotos.map((p) => p.url)}
          photoLabels={galleryPhotos.map((p) => p.label)}
          currentIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
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