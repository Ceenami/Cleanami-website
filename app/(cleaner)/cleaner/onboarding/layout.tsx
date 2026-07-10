import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function CleanerOnboardingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const userRole = user?.user_metadata?.role;

  if (!user || userRole !== "cleaner") {
    redirect("/sign-in");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
    </div>
  );
}
