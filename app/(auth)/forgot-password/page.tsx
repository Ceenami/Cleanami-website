import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export default function Page() {
  return (
    <div className="relative z-10 w-full max-w-md p-8 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-brand/60">
          <span className="text-brand">Reset</span> your password
        </h1>
        <p className="mt-2 text-gray-600">
          Enter the email address on your account and we&apos;ll send you a link
          to set a new password.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="mt-8 text-center text-sm text-gray-500">
        Remembered it?{" "}
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
