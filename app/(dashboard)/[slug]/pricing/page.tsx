import { db } from "@/db";
import { asc, desc } from "drizzle-orm";
import {
  basePricingRules,
  sqftSurchargeRules,
  pricingUploads,
} from "@/db/schemas";
import { format } from "date-fns";
import { PricingUploadModal } from "@/components/dashbboard/admin/ui/PricingUploadModal";

export default async function AdminPricingPage() {
  const [
    basePrices,
    sqftSurcharges,
    laundryRules,
    hotTubRules,
    uploadHistory,
  ] = await Promise.all([
    db.query.basePricingRules.findMany({ orderBy: asc(basePricingRules.bedrooms) }),
    db.query.sqftSurchargeRules.findMany({ orderBy: asc(sqftSurchargeRules.rangeStart) }),
    db.query.laundryPricingRules.findMany(),
    db.query.hotTubPricingRules.findMany(),
    db.query.pricingUploads.findMany({ orderBy: desc(pricingUploads.createdAt), limit: 10 }),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-12">
      <div className="border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Pricing Management
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          View active rates and upload new pricing CSVs for each category.
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload History (Last 10)</h2>
        <div className="overflow-x-auto shadow-md rounded-lg bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {uploadHistory.map((upload) => (
                <tr key={upload.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{format(upload.createdAt, "MMM d, yyyy h:mm a")}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{upload.fileName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        upload.status === 'success' ? 'bg-green-100 text-green-800' :
                        upload.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                    }`}>
                      {upload.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-teal-600 hover:text-teal-800">
                    <a href={upload.fileUrl} target="_blank" rel="noopener noreferrer">View File</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Currently Active Prices</h2>
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Base Cleaning Prices</h3>
                <PricingUploadModal fileType="base_prices" buttonText="Upload Base Prices" />
            </div>
            <div className="overflow-x-auto shadow-md rounded-lg bg-white">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bedrooms</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">1 Bath</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">2 Baths</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">3 Baths</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">4 Baths</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">5 Baths</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                    {basePrices.map((row) => (
                        <tr key={row.bedrooms}>
                            <td className="px-6 py-4 font-medium text-gray-900">{row.bedrooms}</td>
                            <td className="px-6 py-4 text-gray-600">${row.price1BathCents / 100}</td>
                            <td className="px-6 py-4 text-gray-600">${row.price2BathCents / 100}</td>
                            <td className="px-6 py-4 text-gray-600">${row.price3BathCents / 100}</td>
                            <td className="px-6 py-4 text-gray-600">${row.price4BathCents / 100}</td>
                            <td className="px-6 py-4 text-gray-600">${row.price5BathCents / 100}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4">
                <div className="lg:col-span-1">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-800">Size Surcharges</h3>
                        <PricingUploadModal fileType="sqft_surcharges" buttonText="Upload Surcharges" />
                    </div>
                    <div className="bg-white shadow-md rounded-lg p-6">
                        <ul className="divide-y divide-gray-200">
                            {sqftSurcharges.map(row => (
                                <li key={row.rangeStart} className="py-3 flex justify-between text-sm">
                                    <span className="font-medium text-gray-800">{row.rangeStart}-{row.rangeEnd} sq ft</span>
                                    <span className="font-semibold text-teal-600">{row.isCustomQuote ? 'Custom Quote' : `+$${row.surchargeCents / 100}`}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="lg:col-span-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">Laundry Pricing</h3>
                                <PricingUploadModal fileType="laundry_pricing" buttonText="Upload Laundry Prices" />
                            </div>
                            <div className="bg-white shadow-md rounded-lg p-6">
                                <ul className="divide-y divide-gray-200">
                                    {laundryRules.map(row => (
                                        <li key={row.serviceType} className="py-3 flex justify-between text-sm">
                                            <span className="font-medium text-gray-800">{row.serviceType}</span>
                                            <span className="font-semibold text-teal-600 text-right">
                                                {row.customerRevenueBaseCents > 0 && `$${row.customerRevenueBaseCents / 100} base + `}
                                                ${row.customerRevenuePerLoadCents / 100}/load
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">Hot Tub Pricing</h3>
                                <PricingUploadModal fileType="hot_tub_pricing" buttonText="Upload Hot Tub Prices" />
                            </div>
                            <div className="bg-white shadow-md rounded-lg p-6">
                                <ul className="divide-y divide-gray-200">
                                    {hotTubRules.map(row => (
                                        <li key={row.serviceType} className="py-3 flex justify-between text-sm">
                                            <span className="font-medium text-gray-800">{row.serviceType}</span>
                                            <span className="font-semibold text-teal-600">${row.customerRevenueCents / 100}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </div>
      <div id='modal-portal'></div>
    </div>
  );
}