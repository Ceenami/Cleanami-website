'use client'

import { useState } from "react";
import { FAQItem } from "./FAQItem";

const faqs = [
  {
    question: "How does the iCal sync work?",
    answer:
      "You provide us with the iCal link from your booking platform (like Airbnb or VRBO). Our system automatically polls it for new guest check-outs and schedules a turnover clean for that day, ensuring your property is always ready for the next arrival.",
  },
  {
    question: "What's included in a standard turnover clean?",
    answer:
      "Our standard turnover includes a full cleaning of all rooms, sanitizing kitchens and bathrooms, making beds, staging the property according to your checklist, and restocking basic toiletries. Add-ons like laundry and hot tub service are also available.",
  },
  {
    question: "How is pricing determined?",
    answer:
      "We use a transparent, flat-rate pricing model based on your property's size (bedrooms, bathrooms, square footage) and selected add-ons. You see the price upfront, and it remains consistent for every single cleaning during your subscription.",
  },
  {
    question: "What happens if a cleaner is late or doesn't show up?",
    answer:
      "Reliability is our top priority. We use GPS tracking to monitor arrivals and have a multi-tiered backup system. If a primary cleaner is late, a pre-assigned backup is automatically notified. For last-minute issues, our on-call pool ensures your clean is covered.",
  },
];

export const FAQSection = () => {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

    const toggleFaq = (index: number) => {
        setOpenFaqIndex(openFaqIndex === index ? null : index);
    };
  return (
    <section className="py-20">
      <div className="container mx-auto px-4 max-w-3xl">
        <h2 className="text-4xl md:text-6xl font-bold text-brand/80 text-center mb-12">
          Frequently Asked Questions
        </h2>
        <div className="divide-y divide-gray-200">
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              faq={faq}
              isOpen={openFaqIndex === index}
              onToggle={() => toggleFaq(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
