
import { JobHistory } from "@/components/dashbboard/admin/customer-management/JobHistory";
import { PaymentHistory } from "@/components/dashbboard/admin/customer-management/PaymentHistory";
import { Services } from "@/components/dashbboard/admin/customer-management/Services";
import { Subscriptions } from "@/components/dashbboard/admin/customer-management/Subscriptions";
import { CustomerPropertiesManager } from "@/components/dashbboard/admin/customer-management/CustomerPropertiesManager";
import { EditCustomerCard } from "@/components/dashbboard/admin/customer-management/EditCustomerCard";
import { ClipboardListIcon, CreditCardIcon, DollarSign, House, SparkleIcon } from "lucide-react";
import Link from "next/link";
import { getCustomerDetails } from "@/lib/queries/customers";


export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customerDetails = await getCustomerDetails(id);
  
  return (
    <div className="space-y-6">
      <Link
        href='/admin/customer-management'
        className="text-sm font-semibold text-teal-600 hover:text-teal-800"
      >
        &larr; Back to All Customers
      </Link>

      <EditCustomerCard
        customerId={customerDetails.id}
        name={customerDetails.name}
        email={customerDetails.email}
        phone={customerDetails.phone}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="font-semibold text-lg mb-4 flex items-center">
            <House className="h-6 w-6 mr-2 text-teal-500" /> Properties
          </h3>
          <CustomerPropertiesManager properties={customerDetails.properties} />
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="font-semibold text-lg mb-4 flex items-center">
            <SparkleIcon className="h-6 w-6 mr-2 text-teal-500" /> Service Add-ons
          </h3>
          <Services properties={customerDetails.properties} />
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="font-semibold text-lg mb-4 flex items-center">
            <CreditCardIcon className="h-6 w-6 mr-2 text-teal-500" />{" "}
            Subscriptions
          </h3>
          <Subscriptions subscriptions={customerDetails.subscriptions} />
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="font-semibold text-lg mb-4 flex items-center">
          <DollarSign className="h-6 w-6 mr-2 text-teal-500" /> Payment
          History
        </h3>
        <div className="overflow-x-auto max-h-96">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Job ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Amount</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <PaymentHistory />
          </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="font-semibold text-lg mb-4 flex items-center">
          <ClipboardListIcon className="h-6 w-6 mr-2 text-teal-500" /> Job History
        </h3>
        <div className="overflow-x-auto max-h-96">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Job ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Property</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <JobHistory jobs={customerDetails.recentJobs} properties={customerDetails.properties} />
          </table>
        </div>
      </div>
    </div>
  );
};
