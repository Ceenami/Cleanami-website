import { AlertCircle } from "lucide-react";

interface Props {
  errors: Record<string, string[] | undefined>;
  fields: string[];
  message?: string;
}

export const StepFeedback = ({
  errors,
  fields,
  message = "Please complete all required fields to continue.",
}: Props) => {
  const hasError = fields.some((field) => errors[field]);

  if (!hasError) {
    return null;
  }

  return (
    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start">
      <AlertCircle className="h-5 w-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-red-800">{message}</p>
        <ul className="list-disc pl-5 mt-1">
          {fields.map((field) =>
            errors[field]?.map((errorMsg, index) => (
              <li key={`${field}-${index}`} className="text-xs text-red-700">
                {errorMsg}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
