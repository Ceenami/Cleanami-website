import { ValueCard } from "@/components/about";

import { CTA } from "@/components/home";
import { FounderSection } from "@/components/home/FounderSection";
import { CpuIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";

export default function Page() {
  return (
    <>
      <section className="relative h-[50vh] flex items-center justify-center text-center text-white -mt-20">
        
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1611222566360-ef1f0a8c6451?q=80&w=2070&auto=format&fit=crop')",
          }}
        >
          <div className="absolute inset-0 bg-black/50"></div>
        </div>
        <div className="relative z-10 p-4">
          <h1 className="text-4xl mt-8 md:text-6xl font-extrabold tracking-tight">
            The Story Behind Spotless Stays
          </h1>
          <p className="mt-4 text-lg md:text-xl max-w-3xl mx-auto text-gray-200">
            We&apos;re a team of property owners and tech lovers obsessed with
            creating the most reliable turnover service on the planet.
          </p>
        </div>
      </section>

      <main>
        <section className="py-20 bg-white">
          <div className="container mx-auto px-4 max-w-4xl text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Our Mission</h2>
            <p className="text-xl text-gray-600">
              To give vacation rental hosts back their most valuable asset—time.
              We believe managing turnovers should be effortless, reliable, and
              completely automated, allowing hosts to focus on growing their
              business and providing incredible guest experiences.
            </p>
          </div>
        </section>

        <section className="py-20 bg-gray-50">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
              Our Core Values
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-5xl mx-auto">
              <ValueCard
                icon={<CpuIcon className="h-10 w-10 text-white" />}
                title="Technology First"
                description="We build smart, automated systems that eliminate manual work, prevent errors, and create a seamless experience from booking to checkout."
              />
              <ValueCard
                icon={<ShieldCheckIcon className="h-10 w-10 text-white" />}
                title="Uncompromising Reliability"
                description="Your business depends on us. We've built a system of accountability with GPS tracking, tiered backups, and performance monitoring to ensure no clean is ever missed."
              />
              <ValueCard
                icon={<UsersIcon className="h-10 w-10 text-white" />}
                title="True Partnership"
                description="We treat your property like our own. From custom checklists to transparent communication, we work with you to guarantee a perfect, 5-star clean, every time."
              />
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-12">
              Meet the Team
            </h2>
            <FounderSection />
          </div>
        </section>

        <section className="bg-brand/50 text-white">
          <div className="container mx-auto px-4 py-16 text-center">
            <h2 className="text-3xl font-bold">
              Join the Automation Revolution
            </h2>
            <p className="mt-2 mb-6 text-lg text-gray-300">
              Experience the peace of mind that comes with truly reliable
              turnovers.
            </p>
            <CTA />
          </div>
        </section>
      </main>
    </>
  );
}
