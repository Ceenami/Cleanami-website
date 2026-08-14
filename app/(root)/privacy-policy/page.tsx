import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | CleanNami",
  description:
    "How CleanNami collects, uses, discloses, and protects information for customers, cleaners, contractors, and applicants.",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-2xl font-bold text-brand mb-4">{title}</h2>
      <div className="space-y-4 text-gray-700 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-2">
      {children}
    </h3>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-6 space-y-2">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="bg-white">
      <section className="py-16 md:py-20 bg-gray-50 border-b border-gray-100">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-gray-900">
            Privacy Policy
          </h1>
          <p className="mt-4 text-gray-600">
            Effective Date: August 14, 2026 &nbsp;|&nbsp; Last Updated: August
            14, 2026
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 max-w-4xl py-16">
        <p className="text-gray-700 leading-relaxed mb-10">
          CleanNami (&ldquo;CleanNami,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;) provides vacation rental
          turnover cleaning services, including the CleanNami website,
          customer portal, cleaner portal, and mobile application
          (collectively, the &ldquo;Services&rdquo;). This Privacy Policy
          explains how we collect, use, disclose, and protect information
          when customers, cleaners, contractors, applicants, and other users
          interact with our Services.
        </p>

        <Section title="1. Information We Collect">
          <SubHeading>A. Account and Contact Information</SubHeading>
          <List
            items={[
              "Name, email address, phone number, and login/account credentials.",
              "Customer property contact information and cleaner/contractor contact information.",
              "Support messages, setup-call requests, and communications with CleanNami.",
            ]}
          />

          <SubHeading>B. Customer and Property Information</SubHeading>
          <List
            items={[
              "Property address, city, square footage, bedrooms, bathrooms, check-in/check-out times, and other property details used to price and schedule cleaning services.",
              "Property instructions such as parking, access, entry instructions, supply locations, special cleaning notes, checklist preferences, restocking requests, laundry instructions, hot tub instructions, and other turnover requirements.",
              "Customer-uploaded checklists, photos, documents, calendar links, and related setup information.",
            ]}
          />

          <SubHeading>C. Calendar and Booking Information</SubHeading>
          <List
            items={[
              "Calendar links, iCal feeds, checkout dates, booking dates, clean dates, and related scheduling information.",
              "Calendar validation status, sync history, and job-generation records.",
              "We use calendar information to schedule and manage vacation rental turnover cleans. Calendar links are read-only; CleanNami cannot modify your bookings through an iCal link.",
            ]}
          />

          <SubHeading>D. Cleaner Work Information</SubHeading>
          <List
            items={[
              "Cleaner availability, assigned jobs, accepted or declined jobs, check-in/check-out activity, work status, job notes, submitted checklists, restocking reports, issue reports, and proof-of-work submissions.",
              "Cleaner qualifications, service areas, laundry capability, hot tub capability, onboarding status, payout readiness, and related operational information.",
              "Performance and accountability records such as timeliness, completion status, missed availability deadlines, call-outs, evidence review results, and admin notes.",
            ]}
          />

          <SubHeading>E. Location Information</SubHeading>
          <List
            items={[
              "The CleanNami mobile app may collect precise location data when cleaners use GPS check-in/check-out, job verification, geofencing, background location verification, or related accountability features.",
              "Location data may include GPS coordinates, timestamps, cleaner ID, job ID, and arrival/departure records.",
              "If background location is enabled, location may be collected during assigned work periods or while job-verification features are active, depending on device permissions and app settings.",
              "We use location information to verify attendance, confirm arrival and departure, support customer-dispute review, improve job accountability, and manage cleaner safety and operations.",
            ]}
          />

          <SubHeading>F. Photos, Files, and Uploaded Content</SubHeading>
          <List
            items={[
              "Photos, videos if supported, checklists, receipts, documents, uploaded property files, proof-of-work files, and issue-report evidence.",
              "Uploaded files may include metadata such as upload time, file type, job ID, cleaner ID, property ID, and, depending on device settings, location metadata embedded by the device.",
            ]}
          />

          <SubHeading>G. Payment, Billing, and Payout Information</SubHeading>
          <List
            items={[
              "Customer payment status, invoices, charges, refunds, discounts, promo codes, subscription status, and billing records.",
              "Cleaner payout status, expected payout, approved payout, Stripe Connect onboarding status, transfer status, and payout-related records.",
              "CleanNami does not store full credit card numbers. Payment processing and payout onboarding are handled by Stripe or another payment processor, and their handling of payment data is governed by their own terms and privacy policy.",
            ]}
          />

          <SubHeading>H. Device, Usage, and Technical Information</SubHeading>
          <List
            items={[
              "Device type, operating system, app version, browser type, IP address, login activity, session identifiers, crash logs, diagnostic data, and usage activity.",
              "Push notification tokens and communication delivery data.",
              "Security logs, fraud-prevention records, error logs, and system activity logs.",
            ]}
          />
        </Section>

        <Section title="2. How We Use Information">
          <List
            items={[
              "Provide, operate, maintain, and improve the CleanNami Services.",
              "Create customer accounts, cleaner accounts, jobs, assignments, checklists, calendar syncs, invoices, and payouts.",
              "Calculate pricing, expected cleaning time, team size, cleaner pay, labor cost, and job profitability.",
              "Schedule vacation rental turnover cleans based on customer calendars and cleaner availability.",
              "Verify cleaner arrival, departure, location, completion, proof-of-work, and job accountability.",
              "Send operational messages such as booking confirmations, subscription confirmations, job assignments, reminders, cancellation notices, failed payment notices, issue updates, and support messages.",
              "Review completed work, resolve customer issues, handle disputes, approve payouts, and maintain audit records.",
              "Detect, prevent, and address fraud, misuse, duplicate payments, duplicate payouts, security incidents, and technical problems.",
              "Comply with legal, tax, accounting, contractual, and regulatory obligations.",
            ]}
          />
        </Section>

        <Section title="3. How We Share Information">
          <List
            items={[
              "With cleaners and contractors, only as needed to perform assigned work, such as property address, access instructions, checklist requirements, cleaning notes, job time, and customer-approved special instructions.",
              "With customers, as needed to show job status, proof-of-work, completion records, service updates, and issue resolution.",
              "With service providers that help us operate the Services, such as hosting, database, storage, payment processing, email, SMS, push notifications, maps, analytics, scheduling, and customer support providers.",
              "With professional advisors, insurers, auditors, accountants, legal counsel, or authorities when necessary to protect our rights, comply with law, respond to lawful requests, or resolve disputes.",
              "In connection with a business transfer, such as a merger, acquisition, financing, restructuring, or sale of assets, subject to appropriate confidentiality protections.",
            ]}
          />
          <p className="font-semibold text-gray-900">
            We do not sell personal information. We also do not use personal
            information for third-party targeted advertising or cross-app
            tracking.
          </p>
        </Section>

        <Section title="4. Third-Party Services">
          <p>
            CleanNami may use third-party services to operate the website,
            app, payments, notifications, calendars, maps, storage, and
            support workflows. These may include, as applicable:
          </p>
          <List
            items={[
              "Supabase or similar backend/database/storage services.",
              "Stripe for customer payments, subscriptions, Stripe Connect onboarding, and cleaner payouts.",
              "Apple Push Notification service, Firebase Cloud Messaging, or similar push notification services.",
              "Google Calendar, Google Meet, Google Maps, or other Google services used for setup, scheduling, maps, or calendar workflows.",
              "Resend, Twilio, or similar email/SMS providers.",
              "Vercel or similar hosting and deployment services.",
              "Analytics, logging, crash-reporting, and monitoring services used to diagnose problems and improve reliability.",
            ]}
          />
          <p>
            These third parties may process information according to their
            own privacy policies and agreements with CleanNami.
          </p>
        </Section>

        <Section title="5. Location Data and Cleaner GPS Controls">
          <List
            items={[
              "Location features are used for job accountability, not for advertising.",
              "Cleaners may be asked to grant location permission to use check-in/check-out, geofencing, background GPS verification, or job attendance features.",
              "If a cleaner disables location permission, some job-verification features may not work, and CleanNami may be unable to assign or verify certain work through the app.",
              "Location records may be reviewed by administrators for operational management, customer-dispute review, safety, and payout verification.",
              "CleanNami does not sell location data.",
            ]}
          />
        </Section>

        <Section title="6. Communications">
          <List
            items={[
              "We may send operational messages by email, SMS, push notification, phone, or in-app message.",
              "Operational messages may include setup links, booking updates, cleaner assignments, reminders, calendar sync alerts, failed payment notices, job-status alerts, payout information, and support communications.",
              "You may opt out of non-essential marketing communications where offered. Some operational messages are required to provide the Services.",
            ]}
          />
        </Section>

        <Section title="7. Data Retention">
          <p>
            We retain information for as long as reasonably necessary to
            provide the Services, manage customer and cleaner relationships,
            maintain business records, resolve disputes, support
            tax/accounting requirements, comply with legal obligations, and
            protect CleanNami, customers, cleaners, and contractors.
          </p>
          <List
            items={[
              "Customer setup sessions and abandoned setup records may be retained for follow-up and service recovery.",
              "Job, GPS, checklist, photo, payout, payment, and dispute records may be retained as business, accounting, and operational records.",
              "If you request deletion, we will delete or de-identify information where reasonably possible, but we may retain records when required for legal, tax, accounting, fraud-prevention, contract, dispute, safety, or legitimate business reasons.",
            ]}
          />
        </Section>

        <Section title="8. Security">
          <p>
            We use reasonable administrative, technical, and organizational
            safeguards designed to protect information against unauthorized
            access, loss, misuse, or alteration. No system is completely
            secure, and we cannot guarantee absolute security. Users are
            responsible for protecting their own login credentials and
            devices.
          </p>
        </Section>

        <Section title="9. Your Choices and Rights">
          <List
            items={[
              "You may request access to, correction of, or deletion of your personal information by contacting us.",
              "You may update certain account information directly in the app or website when those features are available.",
              "You may control app permissions, including location, camera, photos, and notifications, through your device settings. Disabling permissions may limit app functionality.",
              "Depending on your location, you may have additional privacy rights under applicable law. We will respond to verified requests as required by applicable law.",
            ]}
          />
        </Section>

        <Section title="10. Children's Privacy">
          <p>
            The Services are not intended for children under 13. We do not
            knowingly collect personal information from children under 13.
            If we learn that we have collected such information, we will
            take reasonable steps to delete it.
          </p>
        </Section>

        <Section title="11. International Users">
          <p>
            CleanNami is operated from the United States and may use service
            providers located in the United States or other countries. By
            using the Services, you understand that information may be
            processed in countries that may have data-protection rules
            different from those in your location.
          </p>
        </Section>

        <Section title="12. Changes to This Privacy Policy">
          <p>
            We may update this Privacy Policy from time to time. The updated
            version will be posted with a new &ldquo;Last Updated&rdquo;
            date. If changes are material, we may provide additional notice
            through the app, website, email, or other appropriate method.
          </p>
        </Section>

        <Section title="13. Contact Us">
          <p>For privacy questions, requests, or concerns, contact:</p>
          <div className="border border-gray-200 rounded-lg overflow-hidden max-w-md">
            <div className="grid grid-cols-2 border-b border-gray-200">
              <div className="px-4 py-2 font-semibold bg-gray-50">
                Company
              </div>
              <div className="px-4 py-2">CleanNami</div>
            </div>
            <div className="grid grid-cols-2 border-b border-gray-200">
              <div className="px-4 py-2 font-semibold bg-gray-50">Email</div>
              <div className="px-4 py-2">
                <a
                  href="mailto:cleannami@ceenami.com"
                  className="text-brand hover:underline"
                >
                  cleannami@ceenami.com
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2">
              <div className="px-4 py-2 font-semibold bg-gray-50">
                Location
              </div>
              <div className="px-4 py-2">United States</div>
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}
