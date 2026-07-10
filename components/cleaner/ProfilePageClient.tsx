"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Loader } from "lucide-react";
import { useSignOut } from "@/hooks/useSignOut";
import { CleanerPageMessage } from "@/components/cleaner/CleanerPageMessage";
import { parseCleanerApiError } from "@/lib/cleaner/parse-api-error";
import { getReliabilityColor } from "@/lib/cleaner/reliability";

export type CleanerProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  reliabilityScore: number;
  stripeOnboardingComplete: boolean;
  badges: { id: string; name: string; icon: string; description: string }[];
};
import { cn } from "@/lib/utils";

const FAQ_ITEMS = [
  {
    question: "How is my pay calculated?",
    answer:
      "Base pay is your expected hours × $17/hr. Urgent jobs add a $10 bonus. Laundry lead roles earn $5 per load. Late arrivals may reduce pay based on reliability penalties.",
  },
  {
    question: "How do I dispute a late penalty?",
    answer:
      "Open Support & Disputes below, choose Reliability Score, and describe what happened. Our team reviews disputes within 48 hours.",
  },
  {
    question: "What happens if I miss a job?",
    answer:
      "Missing a job without a valid swap or notice affects your reliability score and may result in fewer assignments. Contact support immediately if an emergency occurs.",
  },
];

export function ProfilePageClient() {
  const signOut = useSignOut();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeType, setDisputeType] = useState("pay");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeMessage, setDisputeMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadErrorVariant, setLoadErrorVariant] = useState<"warning" | "error">(
    "warning"
  );

  async function loadProfile() {
    const response = await fetch("/api/cleaner/profile");
    const data = (await response.json()) as {
      profile?: CleanerProfile;
      error?: string;
    };
    if (!response.ok) {
      const parsed = parseCleanerApiError(response, data);
      setLoadErrorVariant(parsed.variant === "error" ? "error" : "warning");
      throw new Error(parsed.message);
    }
    setProfile(data.profile ?? null);
  }

  useEffect(() => {
    loadProfile()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (searchParams.get("stripe") === "complete") {
      loadProfile().catch(() => undefined);
    }
  }, [searchParams]);

  async function handleStripeSetup() {
    setStripeLoading(true);
    try {
      const response = await fetch("/api/cleaner/stripe-onboarding-link");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to start setup");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe setup failed");
      setStripeLoading(false);
    }
  }

  async function handleDisputeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDisputeSubmitting(true);
    setDisputeMessage(null);
    try {
      const response = await fetch("/api/cleaner/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: disputeType,
          description: disputeDescription,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Submit failed");
      setDisputeMessage(data.message);
      setDisputeDescription("");
      setShowDisputeForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setDisputeSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error && !profile) {
    return (
      <CleanerPageMessage
        title="Profile unavailable"
        message={error}
        variant={loadErrorVariant}
      />
    );
  }

  if (!profile) return null;

  const scoreColor = getReliabilityColor(profile.reliabilityScore);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{profile.fullName}</h1>
        <p className="text-sm text-gray-500">{profile.email}</p>
        {profile.phone && (
          <p className="text-sm text-gray-500">{profile.phone}</p>
        )}
      </div>

      <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-gray-500">Reliability score</p>
        <p className={cn("mt-1 text-5xl font-bold", scoreColor)}>
          {profile.reliabilityScore}
          <span className="text-2xl">%</span>
        </p>
      </div>

      {!profile.stripeOnboardingComplete && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4">
          <p className="text-sm font-semibold text-yellow-900">
            Set up payouts to receive pay
          </p>
          <p className="mt-1 text-xs text-yellow-800">
            Connect your bank account through Stripe to get paid for completed
            jobs.
          </p>
          <button
            type="button"
            onClick={handleStripeSetup}
            disabled={stripeLoading}
            className="mt-3 w-full rounded-lg bg-yellow-600 py-2.5 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-50"
          >
            {stripeLoading ? "Redirecting…" : "Set up Stripe payouts"}
          </button>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Badges</h2>
        {profile.badges.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Complete more jobs to earn badges
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profile.badges.map((badge) => (
              <span
                key={badge.id}
                title={badge.description}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/5 px-3 py-1.5 text-sm font-medium text-brand"
              >
                <span aria-hidden>{badge.icon}</span>
                {badge.name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setSupportOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-4 text-left"
        >
          <h2 className="text-sm font-semibold text-gray-900">
            Support & Disputes
          </h2>
          <ChevronDown
            className={cn(
              "h-5 w-5 text-gray-500 transition-transform",
              supportOpen && "rotate-180"
            )}
          />
        </button>

        {supportOpen && (
          <div className="border-t px-4 pb-4">
            <div className="space-y-2 py-3">
              {FAQ_ITEMS.map((faq, index) => (
                <div key={faq.question} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenFaq(openFaq === index ? null : index)
                    }
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-gray-900"
                  >
                    {faq.question}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-gray-400 transition-transform",
                        openFaq === index && "rotate-180"
                      )}
                    />
                  </button>
                  {openFaq === index && (
                    <p className="border-t px-3 py-2.5 text-sm text-gray-600">
                      {faq.answer}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {disputeMessage && (
              <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                {disputeMessage}
              </div>
            )}

            {!showDisputeForm ? (
              <button
                type="button"
                onClick={() => setShowDisputeForm(true)}
                className="w-full rounded-lg border border-brand py-2.5 text-sm font-semibold text-brand hover:bg-brand/5"
              >
                Contact Support
              </button>
            ) : (
              <form onSubmit={handleDisputeSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="dispute-type"
                    className="mb-1 block text-xs font-medium text-gray-600"
                  >
                    Dispute type
                  </label>
                  <select
                    id="dispute-type"
                    value={disputeType}
                    onChange={(e) => setDisputeType(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="pay">Pay</option>
                    <option value="reliability_score">Reliability Score</option>
                    <option value="job_assignment">Job Assignment</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="dispute-description"
                    className="mb-1 block text-xs font-medium text-gray-600"
                  >
                    Description
                  </label>
                  <textarea
                    id="dispute-description"
                    rows={4}
                    required
                    minLength={10}
                    value={disputeDescription}
                    onChange={(e) => setDisputeDescription(e.target.value)}
                    placeholder="Describe the issue…"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDisputeForm(false)}
                    className="flex-1 rounded-lg border py-2 text-sm text-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={disputeSubmitting}
                    className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {disputeSubmitting ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => signOut()}
        className="w-full rounded-xl border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
      >
        Sign out
      </button>
    </div>
  );
}
