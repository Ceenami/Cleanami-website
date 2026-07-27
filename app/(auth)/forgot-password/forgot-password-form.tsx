"use client";

import Form from "next/form";
import { useActionState } from "react";
import { MailIcon } from "lucide-react";
import { requestPasswordReset } from "@/lib/actions/auth.actions";
import { AuthUserForm } from "@/lib/types/auth";

const initialState: AuthUserForm = {
  success: false,
  data: { email: "" },
  error: { message: "" },
};

const ForgotPasswordForm = () => {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialState
  );

  if (state.success) {
    return (
      <div className="rounded-md border border-teal-200 bg-teal-50 p-4 text-center text-sm text-teal-800">
        <p className="font-medium">Check your email.</p>
        <p className="mt-1">
          If an account exists for {state.data.email}, we&apos;ve sent a link to
          set a new password. It expires in one hour.
        </p>
      </div>
    );
  }

  return (
    <Form action={action} className="space-y-6">
      <div>
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MailIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={state.data.email}
            autoComplete="email"
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
            placeholder="Email address"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full justify-center rounded-lg bg-brand px-3 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand/60 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      {state.error.message && (
        <div className="text-center text-red-700">{state.error.message}</div>
      )}
    </Form>
  );
};

export default ForgotPasswordForm;
