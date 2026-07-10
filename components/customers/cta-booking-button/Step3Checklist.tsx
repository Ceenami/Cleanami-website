import { StepsProps } from "@/lib/validations/bookng-modal";
import { FileCheck, Upload, X, ClipboardCheck } from "lucide-react";
import React, { useCallback, useState } from "react";
import { FounderCard } from "../../FounderCard";

interface Step3Props extends StepsProps {
  /** Called when user books a call */
  onBookCall?: () => void;
  /** Called when user continues without booking */
  onContinueSetup?: () => void;
}

export const Step3Checklist = ({ 
  formData, 
  setFormData, 
  errors,
  onBookCall,
  onContinueSetup,
}: Step3Props) => {
  const [isDragging, setIsDragging] = useState(false);

  const useDefault = formData.useDefaultChecklist ?? false;
  const hasSelection = useDefault || (formData.checklistFile && formData.checklistFile.length > 0);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (files && !useDefault) {
        const newFiles = Array.from(files);
        setFormData((prev) => ({
          ...prev,
          checklistFile: [...(prev.checklistFile || []), ...newFiles],
        }));
      }
    },
    [setFormData, useDefault]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const removeFile = (fileToRemove: File) => {
    setFormData((prev) => ({
      ...prev,
      checklistFile: prev.checklistFile?.filter(
        (file) => file !== fileToRemove
      ),
    }));
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!useDefault) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleUseDefaultChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setFormData((prev) => ({
      ...prev,
      useDefaultChecklist: isChecked,
      checklistFile: isChecked ? [] : prev.checklistFile,
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">
          Cleaning Checklist
        </h3>
        {/* Reassurance text - per spec */}
        <div className="mt-3 bg-teal-50 border border-teal-200 rounded-lg p-4 flex items-start gap-3">
          <ClipboardCheck className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-teal-800 font-medium">
              A checklist is required to guarantee consistent, 5-star turnovers.
            </p>
            <p className="text-sm text-teal-700 mt-1">
              If you don&apos;t have one, our default checklist covers everything needed 
              for a professional vacation rental reset.
            </p>
          </div>
        </div>
      </div>

      {/* Validation error message */}
      {errors?.checklistFile && (
        <div className="p-3 bg-red-50 border-l-4 border-red-400">
          <p className="text-sm text-red-700">{errors.checklistFile[0]}</p>
        </div>
      )}

      {/* Option to use the default checklist */}
      <div className="flex items-start p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center h-5">
          <input
            id="default-checklist"
            name="default-checklist"
            type="checkbox"
            checked={useDefault}
            onChange={handleUseDefaultChange}
            className="focus:ring-teal-500 h-4 w-4 text-teal-600 border-gray-300 rounded"
          />
        </div>
        <div className="ml-3 text-sm">
          <label htmlFor="default-checklist" className="font-medium text-gray-900">
            Use CleanNami basic turnover checklist
          </label>
          <p className="text-gray-500 mt-1">
            Select this option if you don&apos;t have your own checklist file.
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-base font-medium text-gray-500">
            OR
          </span>
        </div>
      </div>
      
      {/* File Upload Section */}
      <div className={`space-y-4 ${useDefault ? "opacity-50 pointer-events-none" : "transition-opacity"}`}>
        <div>
          <h3 className="text-lg font-medium text-gray-900">
            Upload Your Cleaning Checklist(s)
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            You can upload multiple files if needed (e.g., for different seasons or property types).
          </p>
        </div>
        
        {/* List of uploaded files */}
        {formData.checklistFile && formData.checklistFile.length > 0 && (
          <div className="space-y-2">
            {formData.checklistFile.map((file, index) => (
              <div
                key={index}
                className="w-full bg-teal-50 border border-teal-200 rounded-lg p-3 flex items-center justify-between"
              >
                <div className="flex items-center overflow-hidden">
                  <FileCheck className="h-6 w-6 text-teal-500 flex-shrink-0" />
                  <div className="ml-3 overflow-hidden">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(file)}
                  className="text-gray-400 hover:text-gray-600 ml-2 p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Drag and Drop Area */}
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 ${
            isDragging ? "border-teal-500 bg-teal-50" : "border-gray-300"
          } border-dashed rounded-md transition-colors`}
        >
          <div className="space-y-1 text-center">
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <div className="flex text-sm text-gray-600">
              <label
                htmlFor="file-upload"
                className="relative cursor-pointer bg-white rounded-md font-medium text-teal-600 hover:text-teal-500"
              >
                <span>Upload files</span>
                <input
                  id="file-upload"
                  name="file-upload"
                  type="file"
                  className="sr-only"
                  onChange={onFileChange}
                  accept=".pdf,.doc,.docx,.txt"
                  multiple
                  disabled={useDefault}
                />
              </label>
              <p className="pl-1">or drag and drop</p>
            </div>
            <p className="text-xs text-gray-500">PDF, DOCX, TXT up to 10MB</p>
          </div>
        </div>
      </div>

      {/* Founder Card - CALL DECISION POINT B (after checklist selection) */}
      {hasSelection && onBookCall && onContinueSetup && (
        <FounderCard
          onBookCall={onBookCall}
          onContinue={onContinueSetup}
        />
      )}
    </div>
  );
};