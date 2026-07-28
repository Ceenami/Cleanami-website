"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./Card";
import {
  ClipboardListIcon,
  Download,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addPropertyChecklistLink,
  deletePropertyChecklist,
  uploadPropertyChecklist,
} from "@/lib/actions/checklist.actions";
import {
  CHECKLIST_ACCEPT_ATTR,
  CHECKLIST_TYPES_HELP_TEXT,
} from "@/lib/constants/checklist-files";

export type ChecklistFileItem = {
  id: string;
  fileName: string;
  /** Signed URL for a download, or the raw pasted URL for a link; empty when signing failed. */
  url: string;
  /** True when this row is a pasted link (e.g. Google Sheet) rather than an uploaded file. */
  isLink: boolean;
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
  const [linkValue, setLinkValue] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  async function handleAddLink() {
    if (!linkValue.trim()) return;
    setError(null);
    setAddingLink(true);
    try {
      const result = await addPropertyChecklistLink(propertyId, linkValue.trim());
      if (!result.success) {
        setError(result.error ?? "Could not add link");
        return;
      }
      setLinkValue("");
      router.refresh();
    } finally {
      setAddingLink(false);
    }
  }

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

  const busy = uploading || isPending || addingLink;

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
              accept={CHECKLIST_ACCEPT_ATTR}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </label>
          <p className="mt-2 text-xs text-gray-500">
            {CHECKLIST_TYPES_HELP_TEXT}. The newest upload is used for the next
            clean.
          </p>

          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="url"
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                placeholder="Or paste a Google Sheet link"
                disabled={busy || addingLink}
                className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
            </div>
            <button
              type="button"
              onClick={handleAddLink}
              disabled={busy || addingLink || !linkValue.trim()}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {addingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </button>
          </div>

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
                            title={item.isLink ? "Open link" : "Download"}
                            className="text-gray-400 hover:text-teal-600"
                          >
                            {item.isLink ? (
                              <ExternalLink className="h-4 w-4" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
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
