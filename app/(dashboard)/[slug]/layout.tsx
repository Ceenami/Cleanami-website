import { redirect } from "next/navigation";
import { getCustomerPortalLayoutAuth } from "@/lib/customer-auth";

export default async function CustomerSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (slug === "customer") {
    const { customerId, error } = await getCustomerPortalLayoutAuth();
    if (!customerId) {
      redirect(`/?portalBlocked=1&message=${encodeURIComponent(error ?? "Portal unavailable")}`);
    }
  }

  return children;
}
