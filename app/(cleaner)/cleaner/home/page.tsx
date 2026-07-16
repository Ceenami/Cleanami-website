import { Suspense } from "react";
import { Loader } from "lucide-react";
import { CleanerHomeClient } from "@/components/cleaner/CleanerHomeClient";

export default function CleanerHomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader className="h-8 w-8 animate-spin text-brand" />
        </div>
      }
    >
      <CleanerHomeClient />
    </Suspense>
  );
}
