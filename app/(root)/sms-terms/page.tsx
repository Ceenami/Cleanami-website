import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contractor SMS Terms | CleanNami",
  description:
    "CleanNami LLC contractor operational SMS terms, including message frequency, opt-out instructions, support, and optional consent.",
};

export default function SmsTermsPage() {
  return (
    <main className="bg-white">
      <section className="py-16 md:py-20 bg-gray-50 border-b border-gray-100">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-gray-900">
            CleanNami Contractor Terms
          </h1>
          <p className="mt-4 text-gray-600">Operational SMS Terms</p>
          <p className="mt-2 text-sm text-gray-600">
            Last Updated: October 28, 2026
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 max-w-4xl py-16 space-y-10 text-gray-700 leading-relaxed">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-brand">Operational messages</h2>
          <p>
            By separately opting in to CleanNami LLC operational text messages,
            you agree to receive recurring SMS communications regarding cleaner
            availability submissions, cleaning assignments, assignment changes,
            confirmations, reminders, urgent scheduling updates, and related
            contractor operations.
          </p>
          <p>
            Message frequency varies depending on your availability and cleaning
            assignments. Message and data rates may apply.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-brand">Opt out and get help</h2>
          <p>
            You may reply STOP at any time to stop receiving SMS messages or HELP
            for assistance. You may also contact us at{" "}
            <a
              href="mailto:cleannami@ceenami.com"
              className="text-brand underline underline-offset-4 break-words"
            >
              cleannami@ceenami.com
            </a>
            .
          </p>
          <p>
            Opting out of SMS does not automatically cancel an accepted cleaning
            assignment. Contractors must continue monitoring their CleanNami
            dashboard or designated email channel and notify operations if they
            cannot fulfill an assignment.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-brand">Optional consent</h2>
          <p>
            Consent to receive SMS is optional and is not a condition of
            contractor onboarding. Wireless carriers are not responsible for
            delayed or undelivered messages.
          </p>
        </section>

        <p>
          See our{" "}
          <Link
            href="/privacy-policy"
            className="text-brand underline underline-offset-4"
          >
            Privacy Policy
          </Link>{" "}
          for information about how we use and protect your information.
        </p>
      </div>
    </main>
  );
}
