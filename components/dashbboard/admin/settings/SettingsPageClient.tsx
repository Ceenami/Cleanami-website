"use client";
import React, { useState, useEffect } from "react";

export default function SettingsPageClient() {
  const [featureFlags, setFeatureFlags] = useState<{ [k: string]: boolean }>({});

  useEffect(() => {
    const f = localStorage.getItem("admin_feature_flags");
    if (f) setFeatureFlags(JSON.parse(f));
  }, []);

  const toggle = (key: string) => {
    const next = { ...featureFlags, [key]: !featureFlags[key] };
    setFeatureFlags(next);
    localStorage.setItem("admin_feature_flags", JSON.stringify(next));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Settings & Security</h2>
      <div className="p-4 border rounded">
        <h3 className="font-medium">Feature Flags</h3>
        <div className="mt-2 space-y-2">
          {['enableBetaPricing','showInternalNotes','maintenanceMode'].map((k) => (
            <div key={k} className="flex items-center justify-between">
              <div>{k}</div>
              <button onClick={() => toggle(k)} className="btn">
                {featureFlags[k] ? 'On' : 'Off'}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 border rounded">
        <h3 className="font-medium">Server Info</h3>
        <div className="text-sm text-muted-foreground mt-2">Environment: {process.env.NODE_ENV || 'development'}</div>
      </div>
    </div>
  );
}
