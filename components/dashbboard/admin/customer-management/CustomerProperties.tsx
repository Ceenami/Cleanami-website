import { CustomerDetails } from "@/lib/queries/customers";

interface CustomerPropertiesProps {
  properties: CustomerDetails['properties'];
}

interface CustomerPropertiesProps {
  properties: CustomerDetails['properties'];
}

export const CustomerProperties = ({ properties = [] }: CustomerPropertiesProps) => {
  return (
    <ul className="space-y-2">
      {properties.length > 0 ? (
        properties.map((p) => (
          <li key={p.id} className="text-sm text-gray-700">
            {p.address}
          </li>
        ))
      ) : (
        <p className="text-sm text-gray-500">No properties found.</p>
      )}
    </ul>
  );
};