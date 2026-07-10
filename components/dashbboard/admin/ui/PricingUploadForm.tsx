"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { handleFileUpload, PricingFileType } from "@/lib/actions/pricing.actions";

export const PricingUploadForm = ({
  isOpen,
  onClose,
  fileType,
}: {
  isOpen: boolean;
  onClose: () => void;
  fileType: PricingFileType;
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setFeedback({ message: "Please select a CSV file.", isError: true });
      return;
    }

    setIsUploading(true);
    setFeedback(null);

    const formData = new FormData();
    formData.append("pricingCsv", selectedFile);

    const result = await handleFileUpload(formData, fileType);

    setIsUploading(false);
    setFeedback({
      message: result.message,
      isError: !result.success,
    });

    if (result.success) {
      setTimeout(() => {
        onClose();
        window.location.reload(); // Reload the page to show new data
      }, 1500);
    }
  };

  if (!isOpen) return null;
  if (!isMounted) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Upload New Pricing CSV</h2>
        <p className="text-sm text-gray-500 mb-4">You are uploading prices for: <strong className="capitalize">{fileType.replace('_', ' ')}</strong></p>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700 mb-2">
              Select CSV File
            </label>
            <input
              id="file-upload"
              name="pricingCsv"
              type="file"
              accept=".csv"
              onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
            />
          </div>
          <div className="mt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-4 py-2 bg-teal-500 text-white font-semibold rounded-lg shadow-md hover:bg-teal-600 disabled:bg-teal-300 disabled:cursor-not-allowed"
            >
              {isUploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>
        {feedback && (
          <div className={`mt-4 text-sm ${feedback.isError ? 'text-red-600' : 'text-green-600'}`}>
            {feedback.message}
          </div>
        )}
      </div>
    </div>,
    document.getElementById("modal-portal")!
  );
};