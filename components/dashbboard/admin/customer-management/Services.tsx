import { CustomerDetails } from "@/lib/queries/customers";

interface ServicesProps {
  properties: CustomerDetails['properties'];
}

export const Services = ({ properties = [] }: ServicesProps) => {
  const propertiesWithServices = properties.filter(p => p.hasHotTub || p.laundryType !== 'none');

  return (
    <ul className="space-y-3">
      {propertiesWithServices.length > 0 ? (
        propertiesWithServices.map((p) => (
          <li key={p.id} className="text-sm text-gray-700">
            <span className="font-medium block">{p.address}:</span>
            <ul className="list-disc list-inside pl-2 text-gray-600">
              {p.hasHotTub && <li>Hot Tub Service</li>}
              {p.laundryType !== 'none' && (
                <li>
                  Laundry:{" "}
                  {p.laundryType === "in_unit"
                    ? "In-Unit"
                    : "Off-Site"}
                </li>
              )}
            </ul>
          </li>
        ))
      ) : (
        <p className="text-sm text-gray-500">No properties with add-ons.</p>
      )}
    </ul>
  );
};

