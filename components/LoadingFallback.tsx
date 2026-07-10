import React from 'react';

interface FancyLoadingFallbackProps {
  message?: string;
}

export const LoadingFallback = ({ 
  message = "Loading content..." 
}: FancyLoadingFallbackProps) => {
  const brandColor = "#0915AC"; 

  return (
    <div 
      className="flex flex-col items-center justify-center p-8 rounded-lg shadow-xl"
      style={{ 
        backgroundColor: '#ffffff',
        borderColor: brandColor,
        borderWidth: '2px',
        maxWidth: '300px',
        margin: '2rem auto',
        // Optional: subtle blur/glassmorphism if you want a fancier effect
        // backdropFilter: 'blur(5px)',
        // backgroundColor: 'rgba(255, 255, 255, 0.8)',
      }}
    >
      <div 
        className="relative flex items-center justify-center mb-4"
        style={{ width: '60px', height: '60px' }}
      >
        <div 
          className="absolute rounded-full animate-spin"
          style={{
            width: '100%',
            height: '100%',
            border: `4px solid ${brandColor}`,
            borderColor: `${brandColor} transparent ${brandColor} transparent`,
            boxSizing: 'border-box'
          }}
        ></div>
        <div 
          className="absolute w-4 h-4 rounded-full"
          style={{ backgroundColor: brandColor }}
        ></div>
      </div>
      <p 
        className="text-lg font-semibold"
        style={{ color: brandColor }}
      >
        {message}
      </p>

      <p 
        className="text-sm mt-2" 
        style={{ color: '#6B7280' }}
      >
        Please wait a moment.
      </p>
    </div>
  );
};