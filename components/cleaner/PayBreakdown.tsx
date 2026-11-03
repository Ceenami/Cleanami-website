import type { PayBreakdownData } from "@/lib/cleaner/pay-breakdown";
import { cn } from "@/lib/utils";

type PayBreakdownProps = {
  payout: PayBreakdownData;
  className?: string;
};

export function PayBreakdown({ payout, className }: PayBreakdownProps) {
  return (
    <div className={cn("rounded-xl border bg-white p-4", className)}>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Pay breakdown
      </h3>
      {payout.executionPolicy && (
        <p className="mb-3 text-xs text-gray-600">
          Residential base pay is at least $55 before lateness deductions.
          Eligible urgent replacements earn an additional $10. At 30–59 minutes
          late, $5 is deducted per full 10 minutes of total lateness. Removal for
          a no-show or lateness of one hour or more pays $0, including bonuses.
        </p>
      )}
      {payout.historicalEstimate && (
        <p className="mb-2 text-xs text-gray-500">
          Historical hours are estimated from stored pay; no detailed receipt
          was recorded.
        </p>
      )}
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-600">
            {payout.pricingVersion === "residential-v2"
              ? "Hourly base"
              : "Base pay"}
            : {payout.baseHours} hrs × ${payout.baseRate}
          </dt>
          <dd className="font-medium text-gray-900">
            $
            {(
              payout.basePay -
              (payout.pricingVersion === "residential-v2"
                ? (payout.minimumTopUp ?? 0)
                : 0)
            ).toFixed(2)}
          </dd>
        </div>

        {(payout.minimumTopUp ?? 0) > 0 && (
          <div className="flex justify-between gap-4 text-teal-800">
            <dt>Base minimum top-up</dt>
            <dd>+${payout.minimumTopUp!.toFixed(2)}</dd>
          </div>
        )}
        {(payout.leadPay ?? 0) > 0 && (
          <div className="flex justify-between gap-4 text-teal-800">
            <dt>Assigned add-on work: {payout.leadHours} hrs</dt>
            <dd>+${payout.leadPay!.toFixed(2)}</dd>
          </div>
        )}
        {payout.urgentBonusEligible && (
          <div className="flex justify-between gap-4 text-orange-700">
            <dt>Urgent bonus</dt>
            <dd className="font-medium">+${payout.urgentBonus.toFixed(2)}</dd>
          </div>
        )}

        {payout.laundryBonus > 0 && (
          <div className="flex justify-between gap-4 text-amber-800">
            <dt>Laundry bonus: $5 × {payout.laundryLoads} loads</dt>
            <dd className="font-medium">+${payout.laundryBonus.toFixed(2)}</dd>
          </div>
        )}

        {payout.latePenalty > 0 && (
          <div className="flex justify-between gap-4 text-red-700">
            <dt>
              Late penalty
              {payout.latePenaltyReason ? (
                <span className="block text-xs font-normal text-red-600">
                  {payout.latePenaltyReason}
                </span>
              ) : null}
            </dt>
            <dd className="font-medium">−${payout.latePenalty.toFixed(2)}</dd>
          </div>
        )}

        <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 text-base font-bold text-gray-900">
          <dt>Total</dt>
          <dd>${payout.total.toFixed(2)}</dd>
        </div>
      </dl>
    </div>
  );
}
