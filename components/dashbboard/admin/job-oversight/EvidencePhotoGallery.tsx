'use client';

import type { EvidenceRoomGroup } from '@/lib/cleaner/evidence';

/**
 * The room photos a cleaner submitted, grouped the way they were asked for
 * them.
 *
 * This is the only place evidence photos are rendered. Before it existed the
 * packet's photos were uploaded, stored, signed and shipped to the browser and
 * then never drawn: the checklist section only offered a photo when an item
 * carried a `photoIndex`, and nothing has ever written that field. Photos live
 * in `checklistLog.roomPhotos`, keyed by room — not indexed against checklist
 * items — so grouping by room is what actually matches the data.
 */
export function EvidencePhotoGallery({
  roomGroups,
  onOpenPhoto,
  emptyMessage = 'No photos have been submitted for this job yet.',
}: {
  roomGroups: EvidenceRoomGroup[] | undefined;
  /** Receives the photo's position in the flattened, in-order photo list. */
  onOpenPhoto: (flatIndex: number) => void;
  emptyMessage?: string;
}) {
  const groups = roomGroups ?? [];
  const totalPhotos = groups.reduce((sum, g) => sum + g.photos.length, 0);

  if (totalPhotos === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <GalleryHeading count={0} />
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  // Running offset so a click maps to the same flat list the lightbox pages
  // through. Kept in step with `flattenGalleryPhotos` below — both walk the
  // groups in order, so the two orderings cannot drift.
  let flatIndex = 0;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <GalleryHeading count={totalPhotos} />

      <div className="space-y-6">
        {groups.map((group) => {
          const start = flatIndex;
          flatIndex += group.photos.length;
          const short = group.photos.length < group.minPhotos;

          return (
            <section key={group.roomKey}>
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800">
                  {group.label}
                </h4>
                <span
                  className={`text-xs ${
                    short ? 'text-amber-600 font-medium' : 'text-gray-500'
                  }`}
                >
                  {group.minPhotos > 0
                    ? `${group.photos.length} of ${group.minPhotos} required`
                    : `${group.photos.length} photo${
                        group.photos.length === 1 ? '' : 's'
                      }`}
                </span>
              </div>

              {group.photos.length === 0 ? (
                <p className="text-xs text-gray-400 italic">
                  No photo submitted for this room.
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {group.photos.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => onOpenPhoto(start + i)}
                      className="group relative aspect-square rounded-md overflow-hidden bg-gray-100 ring-1 ring-gray-200 hover:ring-2 hover:ring-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      aria-label={`View ${group.label} photo ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived evidence URLs */}
                      <img
                        src={url}
                        alt={`${group.label} photo ${i + 1}`}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function GalleryHeading({ count }: { count: number }) {
  return (
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
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      <h3 className="ml-3 text-lg font-semibold text-gray-800">
        Photos{count > 0 ? ` (${count})` : ''}
      </h3>
    </div>
  );
}

/**
 * The gallery's photos as one ordered list, for the lightbox to page through.
 * Must walk the groups in the same order the gallery renders them.
 */
export function flattenGalleryPhotos(
  roomGroups: EvidenceRoomGroup[] | undefined
): { url: string; label: string }[] {
  return (roomGroups ?? []).flatMap((group) =>
    group.photos.map((url) => ({ url, label: group.label }))
  );
}
