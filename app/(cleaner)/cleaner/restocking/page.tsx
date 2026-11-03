import { redirect } from "next/navigation";
import { z } from "zod";
import { getCleanerAuth } from "@/lib/cleaner-auth";
import { RestockRequestsClient } from "@/components/cleaner/RestockRequestsClient";

export default async function CleanerRestockingPage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  if (!(await getCleanerAuth()).cleanerId) redirect("/sign-in");
  const selected = (await searchParams).requestId;
  return (
    <RestockRequestsClient
      requestId={z.uuid().safeParse(selected).success ? selected : undefined}
    />
  );
}
