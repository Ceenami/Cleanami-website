import Link from "next/link";
import ResetPasswordForm from "./reset-password-form";

export default function Page() {
  return (
    <div className="relative z-10 w-full max-w-md p-8 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-brand/60">
          <span className="text-brand">Choose</span> a new password
        </h1>
        <p className="mt-2 text-gray-600">
          You&apos;re signed in from your reset link. Set a new password to
          finish.
        </p>
      </div>

      <ResetPasswordForm />

      <p className="mt-8 text-center text-sm text-gray-500">
        <Link
          href="/sign-in"
          className="font-semibold leading-6 text-brand hover:text-brand/80"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
