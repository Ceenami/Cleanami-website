import { CalendarDaysIcon, CheckCircleIcon, ClockIcon, CreditCardIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmationModal } from "../ui/ConfirmationModal";
import { SubscriptionsWithDetails } from "@/lib/queries/subscriptions";
import { Subscription } from "@/db/schemas";

interface SubscriptionModalProps {
  subscription: SubscriptionsWithDetails['data'][number];
  onClose: () => void;
  onUpdate: (subscription: Subscription) => void;
}

export const SubscriptionDetailModal = ({
  subscription,
  onClose,
  onUpdate,
}: SubscriptionModalProps) => {
  // Extract only the Subscription fields, plus autoRenew for UI state
  const [localSub, setLocalSub] = useState<Subscription & { autoRenew: boolean }>(() => {
    const sub: Subscription = {
      id: subscription.id,
      customerId: subscription.customerId,
      propertyId: subscription.propertyId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      durationMonths: subscription.durationMonths,
      status: subscription.status,
      firstCleanPaymentId: subscription.firstCleanPaymentId,
      isFirstCleanPrepaid: subscription.isFirstCleanPrepaid,
      startDate: subscription.startDate,
      endDate: subscription.endDate ?? new Date().toISOString().split('T')[0],
      iCalSyncFailed: subscription.iCalSyncFailed ?? false,
      lastSyncAttempt: subscription.lastSyncAttempt ?? null,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
    return { ...sub, autoRenew: true };
  });
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSave = () => {
    const { autoRenew, ...subscriptionData } = localSub;
    void autoRenew;
    onUpdate(subscriptionData);
  };

  const handleStatusChange = (newStatus: 'active' | 'expired' | 'canceled' | 'pending') => {
    setLocalSub((prev) => ({ ...prev, status: newStatus }));
  };

  const handleCancelSubscription = () => {
    handleStatusChange("canceled");
    setLocalSub((prev) => ({ ...prev, autoRenew: false }));
    setIsConfirmingCancel(false);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        aria-modal="true" role="dialog"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] flex flex-col">
          <div className="p-6 border-b flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-800">Manage Subscription</h2>
              <p className="text-sm text-gray-500">{subscription.property?.address ?? 'N/A'}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XIcon /></button>
          </div>

          <div className="p-8 overflow-y-auto flex-1 space-y-6">
            <div className="space-y-2">
              <div className="flex items-center text-sm">
                <CreditCardIcon className="h-5 w-5 mr-3 text-gray-400" /> Plan:{" "}
                <span className="font-semibold ml-2">{localSub.durationMonths} Month Term</span>
              </div>
              <div className="flex items-center text-sm">
                <CalendarDaysIcon className="h-5 w-5 mr-3 text-gray-400" /> Renews on:{" "}
                <span className="font-semibold ml-2">{new Date(localSub.startDate).toLocaleDateString()}</span>
              </div>
              {localSub.isFirstCleanPrepaid && (
                <div className="flex items-center text-sm">
                  <CheckCircleIcon className="h-5 w-5 mr-3 text-green-500" />
                  <span className="font-semibold text-green-700">Prepaid Term</span>
                </div>
              )}
              
              {localSub.status === "pending" && (
                <div className="flex items-center text-sm">
                  <ClockIcon className="h-5 w-5 mr-3 text-yellow-500" />
                  <span className="font-semibold text-yellow-700">Subscription is Paused</span>
                </div>
              )}
            </div>

            {/* <ToggleSwitch
              label="Auto-renew at end of term"
              enabled={localSub.autoRenew}
              onChange={(enabled) => setLocalSub((prev) => ({ ...prev, autoRenew: enabled }))}
            /> */}

            {/* <div>
              <h3 className="text-base font-semibold text-gray-800 mb-3">Actions</h3>
              <div className="space-y-3">
                 
                {localSub.status === "active" && (
                  <ActionButton onClick={() => handleStatusChange("pending")} text="Pause Subscription" className="bg-yellow-500 hover:bg-yellow-600" />
                )}
                {localSub.status === "pending" && (
                  <ActionButton onClick={() => handleStatusChange("active")} text="Resume Subscription" className="bg-green-600 hover:bg-green-700" />
                )}
                {localSub.status !== "canceled" && (
                  <ActionButton onClick={() => setIsConfirmingCancel(true)} text="Cancel Subscription" className="bg-red-600 hover:bg-red-700" />
                )}
                {localSub.status === "canceled" && (
                  <p className="text-sm text-center text-red-700 font-medium bg-red-50 p-3 rounded-md">This subscription is canceled.</p>
                )}
              </div>
            </div> */}
          </div>

          <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end items-center space-x-3">
            <button onClick={onClose} className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2 text-white bg-teal-500 rounded-lg hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-300 text-sm font-medium">Save Changes</button>
          </div>
        </div>
      </div>

      {isConfirmingCancel && (
        <ConfirmationModal
          isOpen={isConfirmingCancel}
          onClose={() => setIsConfirmingCancel(false)}
          onConfirm={handleCancelSubscription}
          title="Cancel Subscription"
        >
          Are you sure you want to cancel the subscription for{" "}
          <strong>{subscription.property?.address}</strong>? This action will take
          effect at the end of the current term and cannot be undone.
        </ConfirmationModal>
      )}
    </>
  );
};

export default SubscriptionDetailModal;