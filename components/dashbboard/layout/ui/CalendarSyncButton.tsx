'use client';

import { useState } from 'react';

// The component now accepts one ID or the other.
type SyncButtonProps = {
  subscriptionId?: string;
  propertyId?: string;
};

export function CalendarSyncButton({ subscriptionId, propertyId }: SyncButtonProps) {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  propertyId = '6dde0d1f-b19e-47b9-aee3-763cf88bbe82'
  const handleSync = async () => {
    if (!subscriptionId && !propertyId) {
      setMessage("Error: Component requires a subscriptionId or propertyId.");
      return;
    }

    setIsLoading(true);
    setMessage('');

    // Dynamically create the request body based on the provided prop.
    const body = subscriptionId ? { subscriptionId } : { propertyId };

    try {
      const response = await fetch('/api/sync-calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body), // Send the correct ID in the request body
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'An unknown error occurred.');
      }

      setMessage(`Sync successful! ${result.message}`);

    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button 
        onClick={handleSync} 
        disabled={isLoading}
        style={{ padding: '10px 15px', cursor: 'pointer' }}
      >
        {isLoading ? 'Syncing...' : 'Sync Calendar Now'}
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}

