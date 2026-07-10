'use client';

export function JobHistorySection({ jobId }: { jobId: string }) {
  void jobId;
  // TODO: Implement when job_history table is added
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">History</h3>
      </div>
      <p className="text-sm text-gray-500">Job history tracking coming soon...</p>
    </div>
  );
}