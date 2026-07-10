export const RadioCard = ({
  id,
  name,
  value,
  checked,
  title,
  description,
  onChange,
}: {
  id: string;
  name: string;
  value: string;
  checked: boolean;
  title: string;
  description: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => (
  <label
    htmlFor={id}
    className={`block p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
      checked
        ? "bg-teal-50 border-teal-500 ring-2 ring-teal-500"
        : "bg-white border-gray-300 hover:border-gray-400"
    }`}
  >
    <input
      type="radio"
      id={id}
      name={name}
      value={value}
      checked={checked}
      onChange={onChange}
      className="sr-only"
    />
    <h4 className="font-semibold text-gray-800">{title}</h4>
    <p className="text-sm text-gray-600 mt-1">{description}</p>
  </label>
);
