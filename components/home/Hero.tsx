
import { CTA } from "./CTA";

export const Hero = () => {
  return (
    <section className="relative h-screen md:h-[70vh] flex items-center justify-center text-white text-center">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1646980241033-cd7abda2ee88?q=80&w=2070&auto=format&fit=crop')",
        }}
      >
        <div className="absolute inset-0 bg-black/60"></div>
      </div>
      <div className="relative z-10 p-4">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">
          Vacation Rental Turnovers &amp; One-Time Home Cleans.
        </h1>
        <p className="mt-4 mb-2 text-lg md:text-xl max-w-3xl mx-auto text-gray-200">
          CleanNami helps vacation rental owners automate turnover cleanings and
          lets local homeowners book reliable one-time residential cleans with
          transparent pricing.
        </p>
        <CTA />

        {/* This line used to read "Subscription-based turnover coverage • Not
            for one-time cleans" — the single most explicit statement on the
            site that CleanNami was vacation-rental only, sitting directly under
            the booking button. Counterproposal §4.16 asks for exactly this kind
            of wording to be removed. */}
        <p>
          Vacation rental subscriptions • One-time residential cleans •
          Transparent pricing
        </p>
      </div>
    </section>
  );
}
