import { MailIcon } from "lucide-react";
import { Card } from "./Card";
import { SUPPORT_EMAIL } from "@/lib/constants";

/**
 * The customer portal's replacement for the admin property edit form.
 *
 * Property details are maintained by CleanNami, not by customers: "Edit
 * property information" is a Phase 5 Admin Improvement, and the spec's customer
 * portal is view-plus-"request property info changes" (§18.5). The reason is
 * pricing — beds, baths, sq ft and laundry loads are all direct inputs to the
 * quote, so a self-serve edit is a self-serve price change, which contradicts
 * "prices are consistent across properties with same specs" (§18.7).
 *
 * Deliberately a mailto and not a ticketing system: no table, no route, no new
 * state to keep in sync. Upgrade it when there is a reason to.
 */
export const RequestPropertyChangeCard = ({
  address,
}: {
  address: string;
}) => {
  const subject = encodeURIComponent("Property update request");
  const body = encodeURIComponent(
    `Hi CleanNami,\n\nI'd like to update the details for my property:\n${address}\n\nWhat needs changing:\n`
  );

  return (
    <Card icon={<MailIcon />} title="Need to change something?">
      <p className="text-sm text-gray-600">
        Property details — size, laundry, hot tub and schedule — are maintained
        by CleanNami so pricing stays consistent across every property with the
        same specs. Email us and we&apos;ll update it, usually the same day.
      </p>
      <a
        href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}
        className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700"
      >
        Email us about this property
      </a>
    </Card>
  );
};
