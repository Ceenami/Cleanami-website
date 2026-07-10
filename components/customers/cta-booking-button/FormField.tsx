import { SignupFormData } from "@/lib/validations/bookng-modal";

export const FormField = ({
  label,
  name,
  type,
  placeholder,
  value,
  onChange,
  error,
}: {
  label: string;
  name: keyof SignupFormData;
  type: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: boolean;
}) => (
  <div>
    <label
      htmlFor={name}
      className="block text-sm font-medium text-gray-700 mb-1"
    >
      {label}
    </label>
    <input
      type={type}
      name={name}
      id={name}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className={`block w-full px-3 py-2 border text-gray-800 rounded-md shadow-sm placeholder-gray-400 focus:outline-none sm:text-sm ${error ? 'border-red-500' : 'border-gray-300'} focus:ring-brand focus:border-brand`}
      required
    />
  </div>
);
