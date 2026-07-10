
import Link from "next/link";
import CredentialsSignUpForm from "./credentials-signup-form";
import localFont from "next/font/local";

const myFont = localFont({
      src: [
        {
          path: '../../../public/fonts/Arkhip_font.ttf',
          weight: '400',
          style: 'normal',
        },
      ],
      variable: '--font-arkhip-font', // Optional: for use with Tailwind CSS
      display: 'swap',
    });

export default function Page() {
  return (
    <div className="relative z-10 w-full max-w-md p-8 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-extrabold ${myFont.className} antialiased text-brand/60 tracking-tight`}>
            <span className="text-brand">Clean</span>Nami
          </h1>
          <p className="mt-2 text-gray-600">Cleaner account signup</p>
          <p className="mt-1 text-sm text-gray-500">
            Only approved cleaner emails can create an account. Property owners
            should complete booking onboarding instead.
          </p>
        </div>

        <CredentialsSignUpForm />

        <p className="mt-8 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-semibold leading-6 text-brand hover:text-brand/80"
          >
            Log in
          </Link>
        </p>
        <p className="mt-3 text-center text-xs text-gray-400">
          Need property cleaning service?{" "}
          <Link href="/" className="text-brand hover:text-brand/80">
            Start the booking flow
          </Link>{" "}
          to create your owner account after payment.
        </p>
      </div>
  );
};