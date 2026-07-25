import { listPromoCodes } from "@/lib/services/promo-code.service";
import { PromoCodesClientPage } from "@/components/dashbboard/admin/promo-codes/PromoCodesClientPage";

export default async function AdminPromoCodesPage() {
  const codes = await listPromoCodes();

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Promo Codes
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Codes customers can enter at checkout. A code discounts the prepaid
          first clean only — it is applied after the subscription-term discount
          and the global first-clean discount, and never affects recurring
          cleans.
        </p>
      </div>

      <PromoCodesClientPage
        codes={codes.map((code) => ({
          ...code,
          startsAt: code.startsAt?.toISOString() ?? null,
          expiresAt: code.expiresAt?.toISOString() ?? null,
          createdAt: code.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
