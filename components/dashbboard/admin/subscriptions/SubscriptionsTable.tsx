import { SubscriptionsWithDetails } from "@/lib/queries/subscriptions";
import { CustomerSubscriptionCancelButton } from "@/components/customer/CustomerSubscriptionCancelButton";
import { useEffect, useState } from "react";

interface SubscriptionsTableProps {
  subscriptions: SubscriptionsWithDetails['data'];
  onManage: (subscription: SubscriptionsWithDetails['data'][number]) => void;
  showCustomerActions?: boolean;
}

const getStatusBadge = (status: 'active' | 'expired' | 'canceled' | 'pending' | null) => {
    switch(status) {
        case 'active': return 'bg-green-100 text-green-800';
        case 'canceled': return 'bg-red-100 text-red-800';
        case 'pending': return 'bg-yellow-100 text-yellow-800';
        case 'expired': return 'bg-gray-100 text-gray-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}

const SafeClientDate = ({ date }: { date: string | null }) => {
    const [formattedDate, setFormattedDate] = useState<string | null>(null);
    useEffect(() => {
        if (date) {
            setFormattedDate(new Date(date).toLocaleDateString());
        }
    }, [date]);
    return <>{formattedDate}</>;
}

export const SubscriptionsTable = ({ subscriptions, onManage, showCustomerActions = false }: SubscriptionsTableProps) => {
  return (
    <tbody className="bg-white divide-y divide-gray-200">
      {subscriptions.map((sub) => (
        <tr key={sub.id} className="hover:bg-gray-50">
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="text-sm font-medium text-gray-900">
              {sub.property?.address ?? 'N/A'}
            </div>
            <div className="text-sm text-gray-500">{sub.customer?.name ?? 'N/A'}</div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(sub.status)}`}>
              {sub.status}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
            {sub.durationMonths} Month Term
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
            <SafeClientDate date={sub.startDate} />
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            {showCustomerActions ? (
              <CustomerSubscriptionCancelButton subscription={sub} />
            ) : (
              <button
                onClick={() => onManage(sub)}
                className="text-teal-600 hover:text-teal-900"
              >
                Manage
              </button>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  );
};

