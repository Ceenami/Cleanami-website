'use client'

import Script from 'next/script'

// Google Ads conversion tracking (see the `send_to` values in ConversionTracking.tsx)
const GOOGLE_ADS_ID = 'AW-17499794760'
// GA4 property used for site traffic measurement
const GA4_MEASUREMENT_ID = 'G-43JSM385K7'

export default function GoogleAnalytics() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA4_MEASUREMENT_ID}');
          gtag('config', '${GOOGLE_ADS_ID}');
        `}
      </Script>
    </>
  )
}
