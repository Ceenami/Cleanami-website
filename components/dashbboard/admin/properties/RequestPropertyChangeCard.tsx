import { MailIcon } from "lucide-react";
import { Card } from "./Card";
import { SUPPORT_EMAIL } from "@/lib/constants";

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
        Property details — size, laundry and hot tub — are maintained
        by CleanNami so pricing stays consistent across every property with the
        same specs. Email us and we&apos;ll update it, usually the same day.
      </p>
      <a
        href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-center font-semibold text-white hover:bg-teal-700"
      >
        Email us about this property
      </a>
    </Card>
  );
};
