import { AlertTriangle } from "lucide-react";
import { RadioCard } from "./RadioCard";
import { StepsProps } from "@/lib/validations/bookng-modal";
import { CheckboxCard } from "./CheckboxCard";

export const Step4Addons = ({ formData, setFormData }: StepsProps) => {
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === "checkbox";
    const checked = (e.target as HTMLInputElement).checked;

    if (name === 'hotTubDrain' && checked) {
      // If drain is selected, also enable basic clean
      setFormData(prev => ({
        ...prev,
        hotTubDrain: true,
        hotTubService: true, 
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: isCheckbox ? checked : value,
      }));
    }
  };

  const handleNoHotTubService = () => {
    setFormData(prev => ({
      ...prev,
      hotTubService: false,
      hotTubDrain: false,
    }));
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Laundry Service</h3>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <RadioCard
            id="laundry-in_unit"
            name="laundryService"
            value="in_unit"
            checked={formData.laundryService === "in_unit"}
            title="In-Unit Laundry"
            description="We'll use the on-property washer and dryer."
            onChange={handleChange}
          />
          <RadioCard
            id="laundry-off_site"
            name="laundryService"
            value="off_site"
            checked={formData.laundryService === "off_site"}
            title="Off-Site Laundry"
            description="$20 base fee + per-load charge."
            onChange={handleChange}
          />
        </div>
        {(formData.laundryService === "in_unit" ||
          formData.laundryService === "off_site") && (
          <div className="mt-4">
            <label
              htmlFor="laundryLoads"
              className="block text-sm font-medium text-gray-700"
            >
              Estimated Loads per Turnover
            </label>
            <input
              type="number"
              name="laundryLoads"
              id="laundryLoads"
              min="0"
              value={formData.laundryLoads || ""}
              onChange={handleChange}
              className="mt-1 block w-full max-w-xs text-gray-800 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              placeholder="e.g., 3"
            />
          </div>
        )}
      </div>
      <div>
        <h3 className="text-lg font-medium text-gray-900">Hot Tub Service</h3>
        <div className="mt-4 flex items-start">
          <div className="flex items-center h-5">
            <input
              id="hasHotTub"
              name="hasHotTub"
              type="checkbox"
              checked={formData.hasHotTub}
              onChange={handleChange}
              className="focus:ring-teal-500 h-4 w-4 text-teal-600 border-gray-300 rounded"
            />
          </div>
          <div className="ml-3 text-sm">
            <label htmlFor="hasHotTub" className="font-medium text-gray-700">
              This property has a hot tub
            </label>
          </div>
        </div>
        {formData.hasHotTub && (
          <div className="mt-4 space-y-4">
            <RadioCard
              id="hotTub-none"
              name="hotTubService"
              value="false"
              checked={!formData.hotTubService && !formData.hotTubDrain}  // ✅ Boolean check
              title="No Service"
              description="I will manage hot tub cleaning myself."
              onChange={handleNoHotTubService}
            />
            {!formData.hotTubService && !formData.hotTubDrain && (  // ✅ Boolean check
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md flex items-start">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2 mt-0.5" />
                <p className="text-sm text-yellow-800">
                  <strong>Disclaimer:</strong> You are responsible for hot tub
                  maintenance if you decline service.
                </p>
              </div>
            )}
            <CheckboxCard
              id="hotTub-basic"
              name="hotTubService"
              value="true"
              checked={formData.hotTubService === true}  // ✅ Boolean check
              title="Basic Clean (+$20)"
              description="Surface clean & chemical test each turnover."
              onChange={handleChange}
            />
            <CheckboxCard
              id="hotTub-drain"
              name="hotTubDrain"
              value="true"
              checked={formData.hotTubDrain === true}
              title="Full Drain & Refill (+$50)"
              description="A scheduled deep clean for a pristine tub."
              onChange={handleChange}
            />
            {formData.hotTubDrain && (
              <div className="mt-4 pl-6">
                <label
                  htmlFor="hotTubDrainCadence"
                  className="block text-sm font-medium text-gray-700"
                >
                  Service Cadence
                </label>
                <select
                  id="hotTubDrainCadence"
                  name="hotTubDrainCadence"
                  value={formData.hotTubDrainCadence}
                  onChange={handleChange}
                  className="mt-1 block w-full text-base text-gray-800 pl-3 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="4_weeks">Every 4 Weeks</option>
                  <option value="6_weeks">Every 6 Weeks</option>
                  <option value="2_months">Every 2 Months</option>
                  <option value="3_months">Every 3 Months</option>
                  <option value="4_months">Every 4 Months</option>
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};


// import { AlertTriangle } from "lucide-react";
// import { RadioCard } from "./RadioCard";
// import { StepsProps } from "@/lib/validations/bookng-modal";
// import { CheckboxCard } from "./CheckboxCard";

// export const Step4Addons = ({ formData, setFormData }: StepsProps) => {
//   const handleChange = (
//     e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
//   ) => {
//     const { name, value, type } = e.target;
//     const isCheckbox = type === "checkbox";
//     const checked = (e.target as HTMLInputElement).checked;

//     // Special handling for hot tub services to ensure 'none' is deselected
//     if (name === 'hotTubService' && checked) {
//         setFormData(prev => ({
//             ...prev,
//             hotTubService: 'basic', // Set to basic when checked
//         }));
//     } else if (name === 'hotTubDrain' && checked) {
//         setFormData(prev => ({
//             ...prev,
//             hotTubDrain: true,
//             // Also select basic clean if drain is selected
//             hotTubService: 'basic',
//         }));
//     } else if (name === 'hotTubDrain' && !checked) {
//         setFormData(prev => ({ ...prev, hotTubDrain: false }));
//     } else {
//         setFormData((prev) => ({
//             ...prev,
//             [name]: isCheckbox ? checked : value,
//         }));
//     }
//   };

//   const handleNoHotTubService = () => {
//     setFormData(prev => ({
//       ...prev,
//       hotTubService: 'none',
//       hotTubDrain: false,
//     }));
//   };

//   return (
//     <div className="space-y-8">
//       <div>
//         <h3 className="text-lg font-medium text-gray-900">Laundry Service</h3>
//         {/* Laundry service code remains the same as in your file */}
//         <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
//           <RadioCard
//             id="laundry-in_unit"
//             name="laundryService"
//             value="in_unit"
//             checked={formData.laundryService === "in_unit"}
//             title="In-Unit Laundry"
//             description="We'll use the on-property washer and dryer."
//             onChange={handleChange}
//           />
//           <RadioCard
//             id="laundry-off_site"
//             name="laundryService"
//             value="off_site"
//             checked={formData.laundryService === "off_site"}
//             title="Off-Site Laundry"
//             description="$20 base fee + per-load charge."
//             onChange={handleChange}
//           />
//         </div>
//         {(formData.laundryService === "in_unit" ||
//           formData.laundryService === "off_site") && (
//           <div className="mt-4">
//             <label
//               htmlFor="laundryLoads"
//               className="block text-sm font-medium text-gray-700"
//             >
//               Estimated Loads per Turnover
//             </label>
//             <input
//               type="number"
//               name="laundryLoads"
//               id="laundryLoads"
//               min="0"
//               value={formData.laundryLoads || ""}
//               onChange={handleChange}
//               className="mt-1 block w-full max-w-xs text-gray-800 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500"
//               placeholder="e.g., 3"
//             />
//           </div>
//         )}
//       </div>
//       <div>
//         <h3 className="text-lg font-medium text-gray-900">Hot Tub Service</h3>
//         <div className="mt-4 flex items-start">
//           <div className="flex items-center h-5">
//             <input
//               id="hasHotTub"
//               name="hasHotTub"
//               type="checkbox"
//               checked={formData.hasHotTub}
//               onChange={handleChange}
//               className="focus:ring-teal-500 h-4 w-4  text-teal-600 border-gray-300 rounded"
//             />
//           </div>
//           <div className="ml-3 text-sm">
//             <label htmlFor="hasHotTub" className="font-medium text-gray-700">
//               This property has a hot tub
//             </label>
//           </div>
//         </div>
//         {formData.hasHotTub && (
//           <div className="mt-4 space-y-4">
//             <RadioCard
//               id="hotTub-none"
//               name="hotTubService"
//               value="none"
//               checked={formData.hotTubService === 'none' && !formData.hotTubDrain}
//               title="No Service"
//               description="I will manage hot tub cleaning myself."
//               onChange={handleNoHotTubService}
//             />
//             {formData.hotTubService === 'none' && !formData.hotTubDrain && (
//               <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md flex items-start">
//                 <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2 mt-0.5" />
//                 <p className="text-sm text-yellow-800">
//                   <strong>Disclaimer:</strong> You are responsible for hot tub
//                   maintenance if you decline service.
//                 </p>
//               </div>
//             )}
//             <CheckboxCard
//               id="hotTub-basic"
//               name="hotTubService"
//               value="basic_clean"
//               checked={formData.hotTubService === "basic"}
//               title="Basic Clean (+$20)"
//               description="Surface clean & chemical test each turnover."
//               onChange={handleChange}
//             />
//             <CheckboxCard
//               id="hotTub-drain"
//               name="hotTubDrain"
//               value="true"
//               checked={formData.hotTubDrain === true}
//               title="Full Drain & Refill (+$50)"
//               description="A scheduled deep clean for a pristine tub."
//               onChange={handleChange}
//             />
//             {formData.hotTubDrain && (
//               <div className="mt-4 pl-6">
//                 <label
//                   htmlFor="hotTubDrainCadence"
//                   className="block text-sm font-medium text-gray-700"
//                 >
//                   Service Cadence
//                 </label>
//                 <select
//                   id="hotTubDrainCadence"
//                   name="hotTubDrainCadence"
//                   value={formData.hotTubDrainCadence}
//                   onChange={handleChange}
//                   className="mt-1 block w-full text-base text-gray-800 pl-3 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2  focus:ring-teal-500"
//                 >
//                   <option value="4_weeks">Every 4 Weeks</option>
//                   <option value="6_weeks">Every 6 Weeks</option>
//                   <option value="2_months">Every 2 Months</option>
//                 </select>
//               </div>
//             )}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

