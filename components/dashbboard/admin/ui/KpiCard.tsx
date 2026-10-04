export const KpiCard = ({ title, value }: { title: string; value: string }) => {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <div className="mt-2 flex items-baseline justify-between">
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
};
