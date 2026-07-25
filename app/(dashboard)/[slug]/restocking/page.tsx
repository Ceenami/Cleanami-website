import { listRestockRequests } from "@/lib/queries/restock-requests";
import { RestockingClientPage } from "@/components/dashbboard/admin/restocking/RestockingClientPage";

export default async function AdminRestockingPage() {
  const requests = await listRestockRequests();

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Restocking Requests
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Supply requests raised by cleaners from their jobs. These are free
          operational requests — nothing here bills the customer.
        </p>
      </div>

      <RestockingClientPage
        requests={requests.map((request) => ({
          ...request,
          createdAt: request.createdAt.toISOString(),
          resolvedAt: request.resolvedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
