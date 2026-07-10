'use client'

import { useState, useEffect } from "react";
import {
  CreditCard,
  Clock,
  CheckCircle,
} from "lucide-react";

export const PaymentTransparencyCard = () => {
  const [activeStep, setActiveStep] = useState(0);

  const paymentSteps = [
    {
      title: "Prepay First Clean",
      icon: CreditCard,
      color: "bg-indigo-500",
      description:
        "To confirm your payment method and secure your booking, the charge for your very first clean is processed immediately upon subscription signup.",
    },
    {
      title: "Pre-Authorization (Night Before)",
      icon: Clock,
      color: "bg-yellow-500",
      description:
        "The night before every subsequent scheduled clean, we perform a payment authorization hold on your card for the estimated service cost.",
    },
    {
      title: "Post-Clean Capture",
      icon: CheckCircle,
      color: "bg-green-500",
      description:
        "The final charge is only captured and processed *after* the cleaning crew completes the job and submits the required evidence packet (photos & checklist).",
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prevStep) => (prevStep + 1) % paymentSteps.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [paymentSteps.length]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-5xl bg-white shadow-2xl rounded-xl overflow-hidden transform transition-all duration-500 hover:shadow-3xl">
        <div className="p-6 sm:p-10 bg-indigo-600 text-white text-center rounded-t-xl">
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-1">
            Our Transparent Payment Flow
          </h1>
          <p className="text-indigo-200">
            Know exactly when and how you are charged for every clean.
          </p>
        </div>

        <div className="p-6 sm:p-10 border-b border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {paymentSteps.map((step, index) => (
              <div
                key={index}
                className={`
                                    p-5 rounded-lg border-2 transition-all duration-500 ease-in-out
                                    ${
                                      index === activeStep
                                        ? `border-indigo-500 shadow-xl bg-white scale-105 transform`
                                        : `border-gray-200 bg-gray-50 opacity-70`
                                    }
                                    hover:bg-white hover:shadow-lg hover:scale-[1.02]
                                `}
              >
                <div className="flex items-center space-x-4 mb-3">
                  <div
                    className={`p-3 rounded-full text-white ${step.color} shadow-lg`}
                  >
                    <step.icon size={24} />
                  </div>
                  <h2 className="text-lg font-bold text-gray-800 flex-1">
                    {step.title}
                  </h2>
                </div>
                <p className="text-sm text-gray-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
{/*
        <div className="p-6 sm:p-10">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">
            How We Calculate Pricing
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {pricingDetails.map((detail, index) => (
              <div
                key={index}
                className="flex flex-col p-6 bg-white border border-gray-100 rounded-lg shadow-md hover:shadow-lg transition duration-300 group"
              >
                <div className="flex items-start mb-3">
                  <div
                    className={`p-3 rounded-full ${detail.color} bg-opacity-10 mr-4 transition duration-300 group-hover:scale-110`}
                  >
                    <detail.icon size={24} className={detail.color} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-900">
                      {detail.title}
                    </h3>
                    <p className="text-2xl font-extrabold mt-1 text-indigo-600">
                      {detail.range}
                    </p>
                  </div>
                </div>
                <p className="text-gray-600 mt-2 text-sm">
                  {detail.description}
                </p>
              </div>
            ))}
          </div>
        </div>
*/}
        <div className="p-6 sm:p-8 bg-gray-800 rounded-b-xl text-center">
          <p className="text-sm text-gray-400">
            All payments are processed securely using{" "}
            <span className="font-semibold text-white">Stripe Connect</span>.
            Your card details are never stored on our servers, ensuring
            industry-leading security.
          </p>
        </div>
      </div>
    </div>
  );
};
