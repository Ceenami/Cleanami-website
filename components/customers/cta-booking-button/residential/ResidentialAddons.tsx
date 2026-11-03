"use client";

export type ResidentialAddonSelection = {
  hotTub: "none" | "basic" | "full";
  inUnitLaundryLoads: number;
};
export function ResidentialAddons({
  value,
  onChange,
  disabled = false,
}: {
  value: ResidentialAddonSelection;
  onChange: (value: ResidentialAddonSelection) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium text-gray-800">
        Optional services
      </legend>
      <label className="block text-sm text-gray-700">
        Hot tub
        <select
          className="mt-1 block w-full rounded-md border border-gray-300 p-2"
          value={value.hotTub}
          onChange={(e) =>
            onChange({
              ...value,
              hotTub: e.target.value as ResidentialAddonSelection["hotTub"],
            })
          }
        >
          <option value="none">None</option>
          <option value="basic">Basic care</option>
          <option value="full">Drain, clean and refill</option>
        </select>
      </label>
      <label className="block text-sm text-gray-700">
        In-unit laundry loads
        <select
          className="mt-1 block w-full rounded-md border border-gray-300 p-2"
          value={value.inUnitLaundryLoads}
          onChange={(e) =>
            onChange({ ...value, inUnitLaundryLoads: Number(e.target.value) })
          }
        >
          {[0, 1, 2].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-gray-500">
        Availability depends on service scope and scheduling. Your quote
        confirms what can be booked.
      </p>
    </fieldset>
  );
}
