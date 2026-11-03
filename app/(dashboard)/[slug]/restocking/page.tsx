import { redirect } from "next/navigation";
import { getAdminAuth } from "@/lib/admin-auth";
import { RestockingClientPage } from "@/components/dashbboard/admin/restocking/RestockingClientPage";
export default async function AdminRestockingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await getAdminAuth()).isAdmin) redirect("/sign-in");
  if ((await params).slug !== "admin") redirect("/admin/restocking");
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Restocking requests
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Open a property to review its supply requests and source jobs.
        </p>
      </div>
      <RestockingClientPage />
    </div>
  );
}
