"use client";
/* eslint-disable @next/next/no-img-element -- Short-lived private evidence URLs bypass shared image caches. */
import { useQuery } from "@tanstack/react-query";
import type { PhaseEvidenceView } from "@/lib/services/phase-evidence.service";
const timestamp = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
export function BeforeAfterEvidence({ jobId, ownerScope = false }: { jobId: string; ownerScope?: boolean }) {
  const { data, isError, refetch } = useQuery<PhaseEvidenceView>({ queryKey: ["phase-evidence", jobId, ownerScope], retry: false,
    queryFn: async () => {
      const result = await fetch(`/api/jobs/${jobId}/evidence-phases${ownerScope ? "?ownerScope=1" : ""}`, { cache: "no-store" });
      if (!result.ok) throw Error("Evidence unavailable");
      return result.json();
    } });
  if (isError) return <p role="alert">Before/After evidence could not be loaded. <button className="underline" onClick={() => refetch()}>Retry</button></p>;
  if (!data?.available) return null;
  const rooms = [...new Set(data.photos.map(p => p.room))];
  return <section className="space-y-4 rounded-lg border bg-white p-5" aria-label="Before and After evidence">
    <h2 className="text-lg font-semibold">Before and After photos</h2>
    {!!data.notes && <p className="whitespace-pre-wrap text-sm">Arrival conditions: {data.notes}</p>}
    {!rooms.length && <p className="text-sm text-gray-600">No phase-labeled evidence is available for this report yet.</p>}
    {rooms.map(room => <div key={room} className="space-y-3 border-t pt-3"><h3 className="font-medium">{room}</h3>
      <div className="grid gap-4 md:grid-cols-2">{(["before", "after"] as const).map(phase => <div key={phase} className="space-y-2">
        <h4 className="font-medium">{phase === "before" ? "Before" : "After"}</h4>
        {!data.photos.some(p => p.room === room && p.phase === phase) && <p className="text-sm text-gray-600">No labeled {phase} photos recorded.</p>}
        {data.photos.filter(p => p.room === room && p.phase === phase).map(photo => <figure key={photo.id} className="space-y-1">
          {photo.url ? <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={`${room} — ${phase}`} className="max-h-64 w-full rounded object-contain" /></a> : <p>Photo temporarily unavailable. Refresh the links.</p>}
          <figcaption className="text-xs text-gray-600">{photo.capturedAt ? `Captured ${timestamp(photo.capturedAt)}` : "Capture time not recorded"} · Uploaded {timestamp(photo.uploadedAt)}</figcaption>
        </figure>)}
      </div>)}</div>
      {data.photos.some(p => p.room === room && p.phase === "unrecorded") && <p className="text-sm text-gray-600">Historical completion photos have no recorded phase; view them in the existing photo gallery.</p>}
    </div>)}
    <button className="min-h-11 text-sm text-teal-700 underline" onClick={() => refetch()}>Refresh photo links</button>
  </section>;
}
