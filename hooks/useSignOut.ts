"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "global" });
    queryClient.clear();
    router.push("/sign-in");
    router.refresh();
  };
}
