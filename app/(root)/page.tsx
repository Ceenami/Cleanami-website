
import { Features, Hero, CTA } from "@/components/home";
import { FAQSection } from "@/components/home/FAQSection";
import { FounderSection } from "@/components/home/FounderSection";
import { PaymentTransparencyCard } from "@/components/home/PaymentTransparencyCard";
import {
  Check,
  CircleDotDashedIcon,
  LinkIcon,
} from "lucide-react";


export default function Home() {
  return (
    <>
      <Hero />
      <main>
        <FounderSection />
        <section className="py-20 bg-gray-50">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl md:text-6xl font-bold mb-4 text-brand/80">
              Turnovers on Autopilot
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-12">
              Our process is designed for complete peace of mind in just three
              simple steps. Once set up, every checkout is handled automatically — no need for manual scheduling or follow-ups.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="flex flex-col items-center">
                <div className="bg-brand rounded-full p-5 mb-4">
                  <CircleDotDashedIcon className="h-10 w-10 text-white" />
                </div>
                <h3 className="text-xl font-bold mb-2">
                  1. Describe Your Property
                </h3>
                <p className="text-gray-600">
                  Tell us your property&apos;s size, unique needs, and upload
                  your custom cleaning checklist. Set your standards once.
                </p>
              </div>
              <div className="flex flex-col items-center">
                <div className="bg-brand rounded-full p-5 mb-4">
                  <LinkIcon className="h-10 w-10 text-white" />
                </div>
                <h3 className="text-xl font-bold mb-2">
                  2. Sync Your Calendar
                </h3>
                <p className="text-gray-600">
                  Connect your Airbnb, VRBO, or iCal link. We automatically
                  detect guest check-outs and schedule your turnovers.
                </p>
              </div>
              <div className="flex flex-col items-center">
                <div className="bg-brand rounded-full p-5 mb-4">
                  <Check className="h-10 w-10 text-white" />
                </div>
                <h3 className="text-xl font-bold mb-2">
                  3. Enjoy 5-Star Reliability
                </h3>
                <p className="text-gray-600">
                  Our GPS-tracked, performance-managed cleaners ensure every
                  turnover is perfect, on-time, and ready for your next guest.
                </p>
              </div>
            </div>
          </div>
        </section>

        <Features />
        <PaymentTransparencyCard />

        {/* <section className="py-20 text-white bg-gradient-to-r from-brand to-brand/50">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl md:text-6xl font-bold text-center mb-12">
              Trusted by Hosts Like You
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white/20 p-8 rounded-lg">
                <p className="mb-4">
                  &quot;Switching to CleanNami was a game-changer. I used to
                  spend hours coordinating cleaners. Now, it&apos;s completely
                  hands-off and the quality is better than ever.&quot;
                </p>
                <p className="font-bold">- Sarah L., Superhost in New Smyrna</p>
              </div>
              <div className="bg-white/20 p-8 rounded-lg">
                <p className="mb-4">
                  &quot;The reliability is what sells it for me. I never have to
                  worry if a clean will get missed. The evidence packets after
                  each job are a fantastic touch for peace of mind.&quot;
                </p>
                <p className="font-bold">
                  - Mike R., Property Manager in Daytona
                </p>
              </div>
              <div className="bg-white/20 p-8 rounded-lg">
                <p className="mb-4">
                  &quot;I was skeptical about the automated scheduling, but it
                  works flawlessly. My cleaner rating has gone up since I
                  started using their service. Highly recommend.&quot;
                </p>
                <p className="font-bold">- Jessica P., Host in Edgewater</p>
              </div>
            </div>
          </div>
        </section> */}

        <FAQSection />


        <CTA title="Ready for Effortless Turnovers?" message="Get your no-obligation quote today." messageStyle="text-brand/60" titleStyle="text-brand/60"/>
      </main>
    </>
  );
}
