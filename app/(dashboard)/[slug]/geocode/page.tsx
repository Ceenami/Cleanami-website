// app/admin/geocode/page.tsx
'use client';

import { useState } from 'react';

export default function GeocodePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);

  const fetchStatus = async () => {
    const res = await fetch('/api/geocode');
    const data = await res.json();
    setStatus(data);
  };

  const handleGeocode = async (target: 'all' | 'cleaners' | 'properties') => {
    setLoading(true);
    setResult(null);
    
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      
      const data = await res.json();
      setResult(data);
      fetchStatus(); // Refresh status
    } catch (error) {
      console.error(error);
      setResult({ error: 'Failed to geocode' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Geocode Addresses</h1>
      
      {/* Status */}
      <div className="mb-8 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Status</h2>
        <button
          onClick={fetchStatus}
          className="mb-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Refresh Status
        </button>
        
        {status && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium">Cleaners</h3>
              <p>Total: {status.cleaners?.total || 0}</p>
              <p>Geocoded: {status.cleaners?.geocoded || 0}</p>
              <p className="text-orange-600">Remaining: {status.cleaners?.remaining || 0}</p>
            </div>
            <div>
              <h3 className="font-medium">Properties</h3>
              <p>Total: {status.properties?.total || 0}</p>
              <p>Geocoded: {status.properties?.geocoded || 0}</p>
              <p className="text-orange-600">Remaining: {status.properties?.remaining || 0}</p>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-4 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Geocode</h2>
        
        <button
          onClick={() => handleGeocode('all')}
          disabled={loading}
          className="w-full px-4 py-3 bg-teal-600 text-white rounded hover:bg-teal-700 disabled:bg-gray-400"
        >
          {loading ? 'Geocoding...' : 'Geocode All Addresses'}
        </button>
        
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleGeocode('cleaners')}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            Geocode Cleaners Only
          </button>
          
          <button
            onClick={() => handleGeocode('properties')}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
          >
            Geocode Properties Only
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="mt-6 bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">
            {result.error ? '❌ Error' : '✅ Success'}
          </h2>
          <pre className="bg-gray-100 p-4 rounded overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}