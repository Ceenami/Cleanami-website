'use client';

import { ChecklistViewer } from '@/components/checklists/ChecklistViewer';

export function PropertyChecklistCard({ jobId }: { jobId: string }) {
  return <ChecklistViewer endpoint={`/api/jobs/${jobId}/checklist`} wrapped />;
}
