export const PriceRow = ({
  label,
  value,
  isBold = false,
}: {
  label: string;
  value: string;
  isBold?: boolean;
}) => (
  <div
    className={`flex justify-between items-center py-2 ${
      isBold ? "font-semibold text-gray-800" : "text-gray-600"
    }`}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);