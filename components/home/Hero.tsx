
import { CTA } from "./CTA";

export const Hero = () => {
  return (
    <section className="relative flex min-h-[calc(100svh-4.5rem)] items-center justify-center overflow-hidden text-center text-white md:min-h-[70svh] md:h-[70vh]">
      <div
        className="absolute inset-0 bg-cover bg-[position:58%_center] md:bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1646980241033-cd7abda2ee88?q=80&w=2070&auto=format&fit=crop')",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/60 to-slate-950/75" />
      </div>
      <div className="relative z-10 mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="text-[clamp(2rem,8vw,2.5rem)] font-extrabold leading-[1.02] tracking-tight sm:text-5xl md:text-6xl md:leading-tight">
          Vacation Rental Turnovers &amp; One-Time Home Cleans.
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-gray-100 sm:text-lg md:text-xl">
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
        <p className="hidden text-sm font-medium text-gray-100 sm:block">
          Vacation rental subscriptions • One-time residential cleans •
          Transparent pricing
        </p>
      </div>
    </section>
  );
}
