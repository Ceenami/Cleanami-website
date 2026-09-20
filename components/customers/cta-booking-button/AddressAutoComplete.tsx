import React, { useState } from 'react';
import { Autocomplete, useLoadScript } from '@react-google-maps/api';
import { serviceAreaPolygons } from '@/lib/google-maps/serviceArea/index.ts';

/**
 * Generic over the form it edits, so the residential wizard reuses it rather
 * than forking a second autocomplete. The only fields it touches are `address`
 * and `isAddressInServiceArea`, which both forms carry — and the boolean it
 * writes is a CLIENT-side convenience only: every charging path re-validates
 * the address against the geocoder server-side, because this value can be set
 * to anything from the browser.
 */
interface Props<T extends AddressFormShape> {
  formData: T;
  setFormData: React.Dispatch<React.SetStateAction<T>>;
  errors: Record<string, string[] | undefined>;
}

type AddressFormShape = {
  address?: string;
  isAddressInServiceArea?: boolean;
};

const libraries: ("places" | "geometry")[] = ['places', 'geometry'];

export const AddressAutocomplete = <T extends AddressFormShape>({
  formData,
  setFormData,
  errors,
}: Props<T>) => {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
    libraries,
  });

  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  
  const isApiAvailable = isLoaded && !loadError;

  const onAutocompleteLoad = (ac: google.maps.places.Autocomplete) => {
    setAutocomplete(ac);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      const address = place.formatted_address || '';
      const lat = place.geometry?.location?.lat();
      const lng = place.geometry?.location?.lng();

      let isAddressInServiceArea = false;

      if (lat && lng && window.google && window.google.maps.geometry) {
        try {
          const selectedLocation = new google.maps.LatLng(lat, lng);
          
          for (const polygonCoords of serviceAreaPolygons) {
            const polygon = new google.maps.Polygon({ paths: polygonCoords });
            if (google.maps.geometry.poly.containsLocation(selectedLocation, polygon)) {
              isAddressInServiceArea = true;
              break;
            }
          }
        } catch (error) {
          console.warn('Service area validation failed:', error);
         
        }
      }

      setFormData(prev => ({
        ...prev,
        address,
        isAddressInServiceArea,
      }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      address: e.target.value,
      isAddressInServiceArea: isApiAvailable ? undefined : undefined,
    }));
  };

  const inputElement = (
    <input
      type="text"
      placeholder={
        isApiAvailable 
          ? "Enter property address" 
          : "Enter property address (suggestions unavailable)"
      }
      value={formData.address || ''}
      onChange={handleChange}
      className={`block w-full px-3 py-2 text-gray-800 border rounded-md shadow-sm focus:outline-none sm:text-sm ${
        errors.address ? 'border-red-500' : 'border-gray-300'
      } focus:ring-teal-500 focus:border-teal-500`}
      required
    />
  );

  if (!isLoaded && !loadError) {
    return (
      <div className="space-y-1">
        {inputElement}
        <p className="text-xs text-gray-500">Loading address suggestions...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-1">
        {inputElement}
        <p className="text-xs text-amber-600">
          Address suggestions temporarily unavailable. You can still enter your address manually.
        </p>
      </div>
    );
  }

  if (isApiAvailable) {
    return (
      <Autocomplete
        onLoad={onAutocompleteLoad}
        onPlaceChanged={onPlaceChanged}
        options={{
          types: ['address'],
          componentRestrictions: { country: ['us'] },
        }}
      >
        {inputElement}
      </Autocomplete>
    );
  }
  return inputElement;
};
