import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

interface FAQItemProps {
  faq: { question: string; answer: string };
  isOpen: boolean;
  onToggle: () => void;
}

export const FAQItem = ({ faq, isOpen, onToggle }: FAQItemProps) => (
  <div className="border-b border-gray-200 py-6">
    <button
      onClick={onToggle}
      className="w-full flex justify-between items-center text-left text-lg font-medium text-gray-800 focus:outline-none"
    >
      <span>{faq.question}</span>
      {isOpen ? (
        <ChevronUpIcon className="h-6 w-6 text-brand" />
      ) : (
        <ChevronDownIcon className="h-6 w-6 text-brand" />
      )}
    </button>
    {isOpen && (
      <div className="mt-4 text-gray-600">
        <p>{faq.answer}</p>
      </div>
    )}
  </div>
);
