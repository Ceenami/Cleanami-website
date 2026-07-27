import Link from "next/link";
import CredentialsSignInForm from "./credentials-signin-form";
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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  // `/auth/callback` and `/auth/confirm` bounce failures back here with
  // `?error=`; without rendering it the user just saw the sign-in form again
  // and no explanation of why their link did not work.
  const { error, reset } = await searchParams;

  return (
    <div className="relative z-10 w-full max-w-md p-8 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-extrabold ${myFont.className} antialiased text-brand/60 tracking-tight`}>
            <span className="text-brand">Clean</span>Nami
          </h1>
          <p className="mt-2 text-gray-600">Welcome back!</p>
        </div>

        {reset && (
          <div className="mb-6 rounded-md border border-teal-200 bg-teal-50 p-3 text-center text-sm text-teal-800">
            Your password has been updated. Sign in with your new password.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
            {error}
          </div>
        )}

        <CredentialsSignInForm />

        <p className="mt-6 text-center text-sm">
          <Link
            href="/forgot-password"
            className="font-semibold text-brand hover:text-brand/80"
          >
            Forgot your password?
          </Link>
        </p>

        <p className="mt-4 text-center text-sm text-gray-500">
          Don&apos;t have an account?{" "}
          <Link
          href='/sign-up'
            className="font-semibold leading-6 text-brand hover:text-brand/80"
          >
            Sign up
          </Link>
        </p>
      </div>
  );
};