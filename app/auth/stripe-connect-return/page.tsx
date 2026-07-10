import { StripeConnectReturnClient } from "@/components/auth/StripeConnectReturnClient";

export default async function StripeConnectReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const stripeStatus = status === "refresh" ? "refresh" : "complete";

  return <StripeConnectReturnClient stripeStatus={stripeStatus} />;
}
