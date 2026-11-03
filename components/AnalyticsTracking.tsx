"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { GA4_MEASUREMENT_ID, initializeGoogleTracking } from "@/lib/analytics";

export default function GoogleAnalytics() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(initializeGoogleTracking());
  }, []);
  return enabled ? <Script id="cleannami-google-tag"
    src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`} strategy="afterInteractive" /> : null;
}
