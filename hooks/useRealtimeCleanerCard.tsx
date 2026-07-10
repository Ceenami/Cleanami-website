import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';
import { createClient } from '@/lib/supabase/client';

/**
 * A debounced real-time hook that listens for changes related to a specific job
 * and its assigned cleaners. It invalidates the job details query to trigger a refetch.
 * This version uses the `use-debounce` library for cleaner, more robust implementation.
 * @param jobId The ID of the job to monitor.
 */
export function useRealtimeCleanerCard(jobId?: string) {
  const queryClient = useQueryClient();

  // Create a debounced version of the invalidation function.
  // This will only run 150ms after the last time it was called.
  const handleInvalidate = useDebouncedCallback(() => {
    console.log(`[Real-time Debounced] Change detected for job ${jobId}. Invalidating query.`);
    queryClient.invalidateQueries({ queryKey: ['job-details', jobId] });
  }, 150);

  useEffect(() => {
    if (!jobId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`realtime-cleaner-card-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        handleInvalidate // Call the debounced function
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs_to_cleaners', filter: `job_id=eq.${jobId}` },
        handleInvalidate // Call the debounced function
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cleaners' },
        handleInvalidate // Call the debounced function
      )
      .subscribe();

    // The cleanup function just needs to remove the channel.
    // use-debounce handles its own internal timer cleanup.
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, jobId, handleInvalidate]);
}

