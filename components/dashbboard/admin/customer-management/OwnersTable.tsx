import { Route } from "next";
import Link from "next/link";
import { CustomersResponse } from "@/lib/queries/customers";
import { formatContactValue } from "@/components/dashbboard/admin/ui/formatContact";
import { useEffect, useState } from "react";

interface OwnersTableProps {
  owners: CustomersResponse['data'];
}

const SafeClientDate = ({ date }: { date: Date | null }) => {
    const [formattedDate, setFormattedDate] = useState<string | null>(null);
    useEffect(() => {
        if (date) {
            setFormattedDate(new Date(date).toLocaleDateString());
        }
    }, [date]);
    return <>{formattedDate}</>;
}

export const OwnersTable = ({ owners = [] }: OwnersTableProps) => {
  if (owners.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={7} className="text-center p-12 text-gray-500">
            No customers found.
          </td>
        </tr>
      </tbody>
    )
  }
  
  return (
    <tbody className="divide-y bg-white">
      {owners.map((owner) => (
        <tr key={owner.id} className="hover:bg-gray-50">
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="font-medium text-gray-900">{owner.name}</div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
            {formatContactValue(owner.email)}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
            {formatContactValue(owner.phone)}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-600">
            {owner.propertyCount}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-600">
            {owner.activeSubscriptionCount}
          </td>
           <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            <SafeClientDate date={owner.createdAt} />
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <Link
              href={`/admin/customer-management/${owner.id}` as Route}
              className="text-teal-600 hover:text-teal-900"
            >
              View Details
            </Link>
          </td>
        </tr>
      ))}
    </tbody>
  );
};
