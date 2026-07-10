export const SubscriptionCard = ({
  months,
  selected,
  onSelect,
}: {
  months: number;
  selected: boolean;
  onSelect: (months: number) => void;
}) => (
  <button
    type="button"
    onClick={() => onSelect(months)}
    className={`flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-4 py-4 text-center transition-all duration-200 ${
      selected
        ? "border-teal-500 bg-teal-50 shadow-sm"
        : "border-gray-200 bg-white hover:border-teal-300 hover:bg-gray-50"
    }`}
  >
    <span className="text-2xl font-bold leading-none text-gray-900">
      {months}
    </span>
    <span className="text-sm font-medium text-gray-600">
      {months === 1 ? "Month" : "Months"}
    </span>
  </button>
);
