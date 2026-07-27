"use client";

import Form from "next/form";
import { useActionState } from "react";
import { LockIcon } from "lucide-react";
import { resetPassword } from "@/lib/actions/auth.actions";
import { AuthUserForm } from "@/lib/types/auth";

const initialState: AuthUserForm = {
  success: false,
  data: { email: "" },
  error: { message: "" },
};

const ResetPasswordForm = () => {
  const [state, action, pending] = useActionState(resetPassword, initialState);

  return (
    <Form action={action} className="space-y-6">
      <div>
        <label htmlFor="password" className="sr-only">
          New password
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <LockIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="New password"
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
          />
        </div>
      </div>

      <div>
        <label htmlFor="confirm-password" className="sr-only">
          Confirm new password
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <LockIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Confirm new password"
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full justify-center rounded-lg bg-brand px-3 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand/60 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save new password"}
      </button>

      {state.error.message && (
        <div className="text-center text-red-700">{state.error.message}</div>
      )}
    </Form>
  );
};

export default ResetPasswordForm;
