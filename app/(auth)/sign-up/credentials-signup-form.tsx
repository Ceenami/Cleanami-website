"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signUpUser } from "@/lib/actions/auth.actions";
import Form from "next/form";
import { LockIcon, MailIcon, UserIcon } from "lucide-react";
import { AuthUserForm } from "@/lib/types/auth";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full justify-center rounded-lg bg-brand px-3 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand/60 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
    >
      {pending ? "Creating account..." : "Sign up as cleaner"}
    </button>
  );
}

const CredentialsSignUpForm = () => {
  const initialState: AuthUserForm = {
    success: false,
    data: {
      email: "",
    },
    error: {
      message: "",
    },
  };

  const [data, action] = useActionState(signUpUser, initialState);

  return (
    <Form action={action} className="space-y-6">
      <input type="hidden" name="role" value="cleaner" />

      <div>
        <label htmlFor="name" className="sr-only">
          Full name
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <UserIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
            placeholder="Full name"
          />
        </div>
      </div>

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
            defaultValue={data?.data.email}
            autoComplete="email"
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
            placeholder="Approved cleaner email"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <LockIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Enter your password"
            required
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
          />
        </div>
      </div>

      <div>
        <label htmlFor="confirm-password" className="sr-only">
          Confirm Password
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <LockIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            className="block w-full rounded-md border-gray-300 py-3 pl-10 pr-3 text-gray-900 shadow-sm focus:border-brand focus:ring-brand"
            placeholder="Confirm password"
          />
        </div>
      </div>

      <SubmitButton />

      {data && !data.success && (
        <div className="text-center text-red-700">{data?.error.message}</div>
      )}
    </Form>
  );
};

export default CredentialsSignUpForm;
