import { AvailabilityPageClient } from "@/components/cleaner/AvailabilityPageClient";

export default async function CleanerAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ periodStart?: string | string[] }>;
}) {
  const { periodStart } = await searchParams;
  return (
    <AvailabilityPageClient
      periodStart={typeof periodStart === "string" ? periodStart : undefined}
    />
  );
}
