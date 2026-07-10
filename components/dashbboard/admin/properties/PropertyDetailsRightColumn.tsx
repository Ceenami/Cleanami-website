'use client'
import React from "react";
import { Card } from "./Card";
import { ArrowDown, CheckCircleIcon, ClipboardListIcon, Pencil } from "lucide-react";


export const PropertyDetailesRightColumn = () => {
  // Placeholder data for checklist
  const checklistHistory = [
      { version: 2, uploadDate: '2025-09-15', fileName: 'summer_checklist_v2.pdf', active: true },
      { version: 1, uploadDate: '2025-06-01', fileName: 'spring_checklist_v1.pdf', active: false },
  ]
  const handleSetActiveVersion = (version: number) => {
      console.log("Set active version:", version);
  }
  return (
    <div className="space-y-6">
      <Card
        icon={<ClipboardListIcon />}
        title="Checklist Management"
        contentPadding="p-0"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Version</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Uploaded</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">File</th>
                <th className="px-4 py-2 text-center font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {checklistHistory.map((item) => (
                <tr key={item.version} className={item.active ? "bg-teal-50" : ""}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center">
                      v{item.version}
                      {item.active && <CheckCircleIcon className="h-4 w-4 ml-2 text-green-600"  />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.uploadDate}</td>
                  <td className="px-4 py-3 text-gray-600">{item.fileName}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center items-center space-x-3">
                      <button title="Download" className="text-gray-400 hover:text-teal-600"><ArrowDown /></button>
                      {!item.active && (
                        <button onClick={() => handleSetActiveVersion(item.version)} title="Set as Active" className="text-gray-400 hover:text-teal-600"><Pencil /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
