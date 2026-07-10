// Add this temporarily to any page for testing
'use client'

export default function TestConversionButton() {
  const fireTestConversion = () => {
    if (typeof window !== 'undefined' && window.gtag) {
      const testId = `TEST-${Date.now()}`;
      console.log('🧪 Firing test conversion:', testId);
      
      window.gtag('event', 'conversion', {
        'send_to': 'AW-17499794760/zER5CNvZ0YsbEMjaxphB',
        'value': 25.0, // Use a real test value
        'currency': 'CHF',
        'transaction_id': testId
      });
    }
  };

  return (
    <div className="p-4 border border-red-500 bg-red-50">
      <p className="text-red-700 mb-2">⚠️ TESTING ONLY - Remove before production</p>
      <button 
        onClick={fireTestConversion}
        className="px-4 py-2 bg-red-500 text-white rounded"
      >
        🧪 Fire Test Conversion
      </button>
    </div>
  );
}