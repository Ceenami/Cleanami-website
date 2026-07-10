import { Suspense } from "react";
import { SignupModal } from "../customers/cta-booking-button";

export const CTA = ({
  title,
  message,
  titleStyle,
  messageStyle,
}: {
  title?: string;
  message?: string;
  style?: string;
  messageStyle?: string;
  titleStyle?: string;
}) => {
  return (
    <section className="bg-transparent text-white">
      <div className="container mx-auto px-4 py-5 text-center">
        <h2 className={`text-3xl font-bold ${titleStyle}`}>{title}</h2>
        <p className={`mt-2 mb-6 text-lg  ${messageStyle}`}>{message}</p>
        <Suspense
          fallback={
            <button className="px-6 py-3 bg-brand text-white font-semibold rounded-lg shadow-md">
              Get Your Price Now!
            </button>
          }
        >
          <SignupModal />
        </Suspense>
      </div>
    </section>
  );
};
