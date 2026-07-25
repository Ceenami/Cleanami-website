import { Route } from "next";
import Link from "next/link";
import { CustomersResponse } from "@/lib/queries/customers";
import { formatContactValue } from "@/components/dashbboard/admin/ui/formatContact";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type Owner = CustomersResponse['data'][number];

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

/**
 * Admin customer delete (task 1.7). The server refuses when the customer has
 * cleaning history or a live subscription — an active-subscription count is
 * already on this row, so disable the button for that case up front rather
 * than making the admin discover it through an error.
 */
const DeleteCustomerButton = ({ owner }: { owner: Owner }) => {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const blockedBySubscription = (owner.activeSubscriptionCount ?? 0) > 0;

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete ${owner.name} (${owner.email})?\n\n` +
        `This removes the customer, their ${owner.propertyCount} propert${owner.propertyCount === 1 ? "y" : "ies"} and their portal login. ` +
        `Only use this for duplicates or records created in error — a customer with cleaning history cannot be deleted. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/customers/${owner.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete this customer.");
      }

      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(`${owner.name} deleted`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete this customer."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting || blockedBySubscription}
      title={
        blockedBySubscription
          ? "Cancel this customer's active subscription before deleting them."
          : undefined
      }
      className="text-red-600 hover:text-red-900 disabled:cursor-not-allowed disabled:text-gray-300"
    >
      {deleting ? "Deleting…" : "Delete"}
    </button>
  );
};

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
            <div className="flex items-center justify-end gap-4">
              <Link
                href={`/admin/customer-management/${owner.id}` as Route}
                className="text-teal-600 hover:text-teal-900"
              >
                View Details
              </Link>
              <DeleteCustomerButton owner={owner} />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  );
};
