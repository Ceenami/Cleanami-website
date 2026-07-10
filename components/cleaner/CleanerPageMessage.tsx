import { cn } from "@/lib/utils";

type CleanerPageMessageProps = {
  title: string;
  message: string;
  variant?: "empty" | "warning" | "error";
};

const variantStyles = {
  empty: "border-gray-300 bg-white text-gray-600",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
} as const;

const titleStyles = {
  empty: "text-gray-900",
  warning: "text-amber-950",
  error: "text-red-900",
} as const;

export function CleanerPageMessage({
  title,
  message,
  variant = "empty",
}: CleanerPageMessageProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-6 text-center",
        variant === "empty" && "border-dashed",
        variantStyles[variant]
      )}
    >
      <p className={cn("font-medium", titleStyles[variant])}>{title}</p>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}
