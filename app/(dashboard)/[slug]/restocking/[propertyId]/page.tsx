import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  getAdminRestockProperty,
  RestockReadError,
} from "@/lib/queries/admin-restocking";
import { RestockRequestsPanel } from "@/components/dashbboard/admin/restocking/RestockRequestsPanel";
export default async function PropertyRestockingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; propertyId: string }>;
  searchParams: Promise<{ requestId?: string }>;
}) {
  if (!(await getAdminAuth()).isAdmin) redirect("/sign-in");
  const { slug, propertyId } = await params;
  if (!z.uuid().safeParse(propertyId).success) notFound();
  if (slug !== "admin") redirect("/admin/restocking");
  let property;
  try {
    property = await getAdminRestockProperty(propertyId);
  } catch (error) {
    if (error instanceof RestockReadError && error.status === 404) notFound();
    throw error;
  }
  const selected = (await searchParams).requestId;
  const requestId = z.uuid().safeParse(selected).success ? selected : undefined;
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/admin/restocking"
        className="text-sm font-medium text-teal-700 hover:underline"
      >
        ← All restocking properties
      </Link>
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {property.address}
        </h1>
        <Link
          href={`/admin/properties/${property.id}` as Route}
          className="mt-2 inline-block text-sm font-medium text-teal-700 hover:underline"
        >
          View property details
        </Link>
      </div>
      <RestockRequestsPanel propertyId={propertyId} requestId={requestId} />
    </div>
  );
}
