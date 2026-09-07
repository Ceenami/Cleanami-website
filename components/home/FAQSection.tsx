'use client'

import { useState } from "react";
import { FAQItem } from "./FAQItem";

const faqs = [
  {
    question: "Do you clean homes, or only vacation rentals?",
    answer:
      "Both. Vacation rental owners can set up an ongoing subscription where turnovers are scheduled automatically from their booking calendar. Homeowners can book a single one-time clean with no subscription and no commitment — you will see the price before you book either way.",
  },
  {
    question: "How does the iCal sync work?",
    answer:
      "This one is for vacation rentals. You provide the iCal link from your booking platform (like Airbnb or VRBO), our system polls it for new guest check-outs, and a turnover clean is scheduled for that day so the property is ready for the next arrival. One-time home cleans need none of this — you pick a date and an arrival time.",
  },
  {
    question: "What's included in a clean?",
    answer:
      "A vacation rental turnover includes a full clean of every room, sanitized kitchens and bathrooms, beds made with fresh linens, staging to your checklist and basic toiletries restocked. Laundry and hot tub service are available as add-ons. A one-time home clean covers the same rooms and surfaces to the same standard, minus the guest-facing staging — we do not change a resident's bed linens or restock their cupboards.",
  },
  {
    question: "How far ahead do I need to book a one-time home clean?",
    answer:
      "At least 48 hours. One-time house cleanings require that much notice so we can properly staff your clean with a cleaner who is available in your area.",
  },
  {
    question: "How is pricing determined?",
    answer:
      "We use a transparent, flat-rate model based on your property's size — bedrooms, bathrooms and square footage — plus whatever options you choose. You see the price upfront. For a subscription it stays the same for every clean; for a one-time clean it is what you pay, once.",
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
