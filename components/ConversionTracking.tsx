'use client'

import Script from 'next/script'
import { useEffect } from 'react'

interface ConversionTrackingProps {
  transactionId: string
  value: number
  currency?: string
}

export default function GoogleConversionTracking({
  transactionId,
  value,
  currency = 'USD'
}: ConversionTrackingProps) {
  useEffect(() => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'conversion', {
        'send_to': 'AW-17499794760/wQ47CITTlskbEMjaxphB',
        'value': value,
        'currency': currency,
        'transaction_id': transactionId
      })
    }
  }, [transactionId, value, currency])

  return (
    <Script id={`conversion-${transactionId}`} strategy="afterInteractive">
      {`
        if (typeof gtag !== 'undefined') {
          gtag('event', 'conversion', {
            'send_to': 'AW-17499794760/wQ47CITTlskbEMjaxphB',
            'value': ${value},
            'currency': '${currency}',
            'transaction_id': '${transactionId}'
          });
        }
      `}
    </Script>
  )
}

declare global {
  interface Window {
    gtag: (...args: any[]) => void
  }
}
