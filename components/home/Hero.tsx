
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
          Effortless Vacation Rental Turnovers.
        </h1>
        <p className="mt-4 mb-2 text-lg md:text-xl max-w-3xl mx-auto text-gray-200">
          CleanNami handles every detail of your vacation rental turnover — from linens and laundry to staging and hot tub care — so you can relax, impress guests, and always get five-star reviews.
        </p>
        <CTA />

          <p>Subscription-based turnover coverage • Not for one-time cleans</p>
      </div>
    </section>
  );
}
