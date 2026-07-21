import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth/server-roles";

export default async function CleanerOnboardingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Authoritative role from the DB (`users.role`), not `user_metadata`.
  const userRole = await getSessionRole();
  if (userRole !== "cleaner") {
    redirect("/sign-in");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
    </div>
  );
}
