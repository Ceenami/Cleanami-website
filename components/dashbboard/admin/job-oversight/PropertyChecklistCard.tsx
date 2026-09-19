'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';

type ChecklistFile = { id: string; fileName: string; url: string };

export function PropertyChecklistCard({ jobId }: { jobId: string }) {
  const [files, setFiles] = useState<ChecklistFile[] | null>(null);
  const [isSnapshot, setIsSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/checklist`);
        if (!response.ok) throw new Error('Failed to load property checklists');
        const body = (await response.json()) as { files?: ChecklistFile[]; snapshot?: boolean };
        if (active) {
          setFiles(body.files ?? []);
          setIsSnapshot(body.snapshot ?? false);
        }
      } catch {
        if (active) setError('Could not load property checklists.');
      }
    })();
    return () => { active = false; };
  }, [jobId]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-5 w-5 text-teal-700" aria-hidden="true" />
        <div>
          <h2 className="font-semibold text-gray-900">{isSnapshot ? 'Issued checklist documents' : 'Property checklists'}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {isSnapshot ? 'Documents issued with this job. Links expire after one hour.' : 'Current property documents. Links expire after one hour.'}
          </p>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {files === null && !error ? <p className="mt-3 text-sm text-gray-500">Loading...</p> : null}
      {files?.length === 0 ? <p className="mt-3 text-sm text-gray-500">No property checklist is attached.</p> : null}
      {files && files.length > 0 ? <ul className="mt-3 space-y-2">{files.map((file) => (
        <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-900 hover:underline">{file.fileName}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></li>
      ))}</ul> : null}
    </section>
  );
}
