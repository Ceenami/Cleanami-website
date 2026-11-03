"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { CustomerJobReport as Report } from "@/lib/customer/job-report";
import {
  EvidencePhotoGallery,
  flattenGalleryPhotos,
} from "@/components/dashbboard/admin/job-oversight/EvidencePhotoGallery";
import { EvidenceReviewModal } from "@/components/dashbboard/admin/job-oversight/modals/EvidenceReviewModal";
import { CustomerJobCancelButton } from "./CustomerJobCancelButton";
import { CustomerJobPromoCodeField } from "./CustomerJobPromoCodeField";

function timestamp(value: string | null) {
  return value
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "America/New_York",
        timeZoneName: "short",
      })
    : "Not recorded yet";
}

export function CustomerJobReport({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const {
    data: report,
    isPending,
    isError,
    refetch,
  } = useQuery<Report>({
    queryKey: ["customer-job-report", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}?ownerScope=1`);
      if (!response.ok) throw new Error("Unable to load your clean report.");
      return response.json();
    },
  });
  if (isPending) return <p>Loading your clean report…</p>;
  if (isError || !report)
    return (
      <p role="alert">
        Unable to load your clean report. Please refresh and try again.
      </p>
    );
  const photos = flattenGalleryPhotos(report.roomGroups);
  return (
    <div className="space-y-6">
      <button
        type="button"
        className="text-sm text-teal-700"
        onClick={() => router.back()}
      >
        Back to your schedule
      </button>
      <section className="rounded-lg bg-white p-6 shadow-md space-y-3">
        <h1 className="text-2xl font-semibold">{report.serviceLabel}</h1>
        {report.purchasedScope?.map((line) => (
          <p key={line} className="text-sm text-gray-700">
            {line}
          </p>
        ))}
        <p>{report.address}</p>
        <p className="capitalize">{report.status?.replaceAll("_", " ")}</p>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-medium">Scheduled arrival</dt>
            <dd>
              {timestamp(report.plannedArrival)}
              {report.arrivalWindowLabel
                ? ` · ${report.arrivalWindowLabel}`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Cleaner departure</dt>
            <dd>{timestamp(report.departureAt)}</dd>
          </div>
          <div>
            <dt className="font-medium">Final evidence submitted</dt>
            <dd>{timestamp(report.evidenceSubmittedAt)}</dd>
          </div>
        </dl>
        <CustomerJobCancelButton
          jobId={jobId}
          status={report.status}
          checkInTime={report.plannedArrival}
        />
        {report.canApplyPromo && (
          <CustomerJobPromoCodeField
            jobId={jobId}
            status={report.status}
            checkInTime={report.plannedArrival}
            paymentIntentId={null}
            paymentStatus={null}
            appliedPromoCode={report.appliedPromoCode}
          />
        )}
      </section>
      <section className="rounded-lg bg-white p-6 shadow-md">
        <h2 className="text-lg font-semibold mb-3">
          Issued cleaning checklist
        </h2>
        {report.checklist.length ? (
          <ul className="space-y-2 text-sm">
            {report.checklist.map((item) => (
              <li key={item.id}>
                <span
                  className={item.completed ? "text-teal-700" : "text-gray-500"}
                >
                  {item.completed ? "Completed" : "Not recorded"}
                </span>{" "}
                — {item.task}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">
            No checklist has been recorded for this clean yet.
          </p>
        )}
      </section>
      {report.publishedNotes.length > 0 && (
        <section className="border-t pt-4">
          <h2 className="font-semibold">Clean report notes</h2>
          {report.publishedNotes.map((note, index) => (
            <p className="text-sm mt-2" key={index}>
              {note}
            </p>
          ))}
        </section>
      )}
      <EvidencePhotoGallery
        roomGroups={report.roomGroups}
        onOpenPhoto={setGalleryIndex}
        emptyMessage="Photos will appear here when submitted."
      />
      {report.roomGroups.some((g) => g.unavailablePhotos > 0) && (
        <p role="status" className="text-sm text-amber-800">
          Some submitted photos are unavailable. Refresh the links or contact
          support if this continues.
        </p>
      )}
      <button className="text-sm text-teal-700" onClick={() => refetch()}>
        Refresh report & photo links
      </button>
      {galleryIndex !== null && photos.length > 0 && (
        <EvidenceReviewModal
          photoUrls={photos.map((photo) => photo.url)}
          photoLabels={photos.map((photo) => photo.label)}
          currentIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
        />
      )}
    </div>
  );
}
