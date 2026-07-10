'use client';

import { SearchIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { useDebounce } from 'use-debounce';

// The component's props remain the same
interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export const SearchBar = ({ onSearch, placeholder = "Search..." }: SearchBarProps) => {
  const [text, setText] = useState('');
  
  // BEST PRACTICE: Debounce the input value.
  // The 'value' will only update after 300ms of the user stopping typing.
  const [value] = useDebounce(text, 300);

  // BEST PRACTICE: Use a useEffect hook to call the onSearch callback.
  // This effect will only run when the debounced 'value' changes.
  useEffect(() => {
    onSearch(value);
  }, [value, onSearch]);

  return (
    // Using a simple div, as form submission is no longer the primary trigger.
    <div className="relative w-full md:w-1/3">
      <input
        type="search"
        value={text} // The input is controlled by the immediate text state
        onChange={(e) => setText(e.target.value)} // Update the text state on every keystroke
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-teal-500 focus:border-teal-500"
        aria-label="Search"
      />
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <SearchIcon className="h-5 w-5 text-gray-400" />
      </div>
    </div>
  );
};
// ```

// ### How to Use

// The way you use this component in your parent file (e.g., `SubscriptionsPageClient.tsx`) remains exactly the same, but the behavior is now much more efficient.

// ```tsx
// Example usage in SubscriptionsPageClient.tsx

// ...
// export const SubscriptionsPageClient = () => {
//   // ... (your existing state and hooks)
//   const [searchTerm, setSearchTerm] = useState('');
  
//   // Note: We no longer need a separate debounced state here,
//   // because the SearchBar component now handles it internally.

//   // The queryKey will use the searchTerm, which is updated by the debounced SearchBar
//   const queryKey = useMemo(() => ['subscriptions', { status: statusFilter, search: searchTerm }], [statusFilter, searchTerm]);

//   // ... (rest of the component)

//   return (
//     <div className="space-y-6">
//       <div className="flex ...">
//         {/* Pass the state setter directly to the SearchBar */}
//         <SearchBar onSearch={setSearchTerm} placeholder="Search by name or address..." />
//         {/* ... (your filter dropdown) */}
//       </div>
//       {/* ... (your table and other components) */}
//     </div>
//   );
// };

