import { Loader2, TriangleAlertIcon } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  confirmButtonText?: string;
  confirmButtonClassName?: string;
  loadingText?: string;
}

export const ConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  icon,
  confirmButtonText = 'Confirm',
  confirmButtonClassName = 'bg-red-600 hover:bg-red-500',
  loadingText = 'Working…',
}: ConfirmationModalProps) => {
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) {
    return null;
  }

  const defaultIcon = (
    <div className="mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
      <TriangleAlertIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
    </div>
  );

  async function handleConfirm() {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Caller should toast errors; keep modal open for retry.
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="sm:flex sm:items-start">
            {icon || defaultIcon}
            <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
              <h3
                className="text-lg font-semibold leading-6 text-gray-900"
                id="modal-title"
              >
                {title}
              </h3>
              <div className="mt-2">
                <div className="text-sm text-gray-500">{children}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 rounded-b-2xl">
          <button
            type="button"
            disabled={isLoading}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto disabled:cursor-not-allowed disabled:opacity-60 ${confirmButtonClassName}`}
            onClick={handleConfirm}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoading ? loadingText : confirmButtonText}
          </button>
          <button
            type="button"
            disabled={isLoading}
            className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
