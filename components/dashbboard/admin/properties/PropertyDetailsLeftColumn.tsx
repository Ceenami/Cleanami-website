import { CogIcon, CreditCardIcon, HouseHeart } from "lucide-react";
import { Card } from "./Card";
import { PropertyDetails } from "@/lib/queries/properties";

interface LeftColumnProps {
  property: PropertyDetails;
  subscription: PropertyDetails["activeSubscription"];
}

export default function PropertyDetailsLeftColumn({
  property,
  subscription,
}: LeftColumnProps) {
  return (
    <div className="space-y-6">
      <Card icon={<HouseHeart className="h-6 w-6" />} title="Property Vitals">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-gray-500">Beds</p>
            <p className="text-xl font-bold text-gray-800">
              {property.bedCount}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Baths</p>
            <p className="text-xl font-bold text-gray-800">
              {property.bathCount}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">SqFt</p>
            <p className="text-xl font-bold text-gray-800">{property.sqFt}</p>
          </div>
        </div>
      </Card>

      <Card icon={<CogIcon className="h-6 w-6" />} title="Service Settings">
        <p className="text-sm">
          Hot Tub Service:{" "}
          <span className="font-semibold">
            {property.hasHotTub ? "Yes" : "No"}
          </span>
        </p>
        <p className="text-sm">
          Laundry Type:{" "}
          <span className="font-semibold capitalize">
            {property.laundryType.replace("_", "-")}
          </span>
        </p>
      </Card>

      <Card icon={<CreditCardIcon />} title="Subscription">
        {subscription ? (
          <>
            <p className="text-sm">
              Status:{" "}
              <span className="font-semibold capitalize">
                {subscription.status}
              </span>
            </p>
            <p className="text-sm">
              Term:{" "}
              <span className="font-semibold">
                {subscription.durationMonths} Months
              </span>
            </p>
            <p className="text-sm">
              Renews:{" "}
              <span className="font-semibold">
                {subscription.startDate
                  ? new Date(subscription.startDate).toLocaleDateString()
                  : "N/A"}
              </span>
            </p>
            <div className="flex gap-2 pt-2">
              <button className="flex-1 text-sm py-2 px-4 rounded-md bg-yellow-500 text-white hover:bg-yellow-600">
                Pause
              </button>
              <button className="flex-1 text-sm py-2 px-4 rounded-md bg-red-600 text-white hover:bg-red-700">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500">
            No active subscription for this property.
          </p>
        )}
      </Card>
    </div>
  );
}
