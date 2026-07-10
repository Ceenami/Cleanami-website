import { Suspense } from "react";
import { Loader } from "lucide-react";
import { JobDetailClient } from "@/components/cleaner/JobDetailClient";

export default async function CleanerJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader className="h-8 w-8 animate-spin text-brand" />
        </div>
      }
    >
      <JobDetailClient jobId={id} />
    </Suspense>
  );
}
