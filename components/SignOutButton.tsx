"use client";

import { useSignOut } from "@/hooks/useSignOut";

export function SignOutButton() {
  const signOut = useSignOut();

  return (
    <button
      type="button"
      onClick={() => signOut()}
      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
    >
      Sign Out
    </button>
  );
}
