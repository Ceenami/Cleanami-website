"use client";
import React, { useState } from "react";
import { PricingUploadForm } from "./PricingUploadForm";
import { PricingFileType } from "@/lib/actions/pricing.actions";

export const PricingUploadModal = ({
  fileType,
  buttonText,
}: {
  fileType: PricingFileType;
  buttonText: string;
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="px-4 py-2 bg-teal-500 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-75"
      >
        {buttonText}
      </button>

      {isModalOpen && (
        <PricingUploadForm
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          fileType={fileType}
        />
      )}
    </>
  );
};