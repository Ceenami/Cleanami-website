import { CustomerDetails } from "@/lib/queries/customers";

interface SubscriptionsProps {
  subscriptions: CustomerDetails['subscriptions'];
}

export const Subscriptions = ({ subscriptions = [] }: SubscriptionsProps) => {
  return (
    <ul className="space-y-3">
      {subscriptions.length > 0 ? (
        subscriptions.map((s) => (
          <li key={s.id} className="text-sm text-gray-700">
            <span className="font-medium block">{s.property?.address ?? 'N/A'}:</span>
            <ul className="list-disc list-inside pl-2 text-gray-600">
              <li>
                Status: <span className="font-medium">{s.status}</span>
              </li>
              <li>
                Term: {s.durationMonths} Month{s.durationMonths && s.durationMonths > 1 ? "s" : ""}
              </li>
            </ul>
          </li>
        ))
       ) : (
        <p className="text-sm text-gray-500">No subscriptions found.</p>
      )}
    </ul>
  );
};

