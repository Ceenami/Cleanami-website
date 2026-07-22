import { getSubscriptionDiscountPercent } from "@/lib/pricing/subscription-discount";

export const SubscriptionCard = ({
  months,
  selected,
  onSelect,
}: {
  months: number;
  selected: boolean;
  onSelect: (months: number) => void;
}) => {
  const discountPercent = getSubscriptionDiscountPercent(months);

  return (
    <button
      type="button"
      onClick={() => onSelect(months)}
      className={`relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-4 py-4 text-center transition-all duration-200 ${
        selected
          ? "border-teal-500 bg-teal-50 shadow-sm"
          : "border-gray-200 bg-white hover:border-teal-300 hover:bg-gray-50"
      }`}
    >
      {discountPercent > 0 && (
        <span className="absolute -top-2 right-2 rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
          Save {discountPercent}%
        </span>
      )}
      <span className="text-2xl font-bold leading-none text-gray-900">
        {months}
      </span>
      <span className="text-sm font-medium text-gray-600">
        {months === 1 ? "Month" : "Months"}
      </span>
    </button>
  );
};
