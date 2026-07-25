"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./Card";
import {
  ClipboardListIcon,
  Download,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  deletePropertyChecklist,
  uploadPropertyChecklist,
} from "@/lib/actions/checklist.actions";

export type ChecklistFileItem = {
  id: string;
  fileName: string;
  /** Signed URL for download; empty when signing failed. */
  url: string;
  createdAt: string | Date;
};

function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const PropertyDetailesRightColumn = ({
  propertyId,
  checklistFiles,
}: {
  propertyId: string;
  checklistFiles: ChecklistFileItem[];
}) => {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadPropertyChecklist(propertyId, formData);
      if (!result.success) {
        setError(result.error ?? "Upload failed");
        return;
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDelete(fileId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePropertyChecklist(fileId);
      if (!result.success) {
        setError(result.error ?? "Delete failed");
        return;
      }
      router.refresh();
    });
  }

  const busy = uploading || isPending;

  return (
    <div className="space-y-6">
      <Card
        icon={<ClipboardListIcon />}
        title="Checklist Management"
        contentPadding="p-0"
      >
        <div className="border-b border-gray-100 p-4">
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600 hover:border-teal-500 hover:text-teal-600 ${
              busy ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading ? "Uploading…" : "Upload new checklist version"}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </label>
          <p className="mt-2 text-xs text-gray-500">
            PDF, JPEG, PNG or WebP, up to 10MB. The newest upload is used for the
            next clean.
          </p>
          {error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        {checklistFiles.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            No checklist uploaded for this property yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">File</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Uploaded</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {checklistFiles.map((item, index) => (
                  <tr key={item.id} className={index === 0 ? "bg-teal-50" : ""}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {item.fileName}
                      {index === 0 && (
                        <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Current
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center space-x-3">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Download"
                            className="text-gray-400 hover:text-teal-600"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          disabled={busy}
                          title="Delete"
                          className="text-gray-400 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
