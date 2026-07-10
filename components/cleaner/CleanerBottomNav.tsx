"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Calendar, User, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/cleaner/jobs", label: "Jobs", icon: Briefcase },
  { href: "/cleaner/availability", label: "Availability", icon: Calendar },
  { href: "/cleaner/pay", label: "Pay", icon: Wallet },
  { href: "/cleaner/profile", label: "Profile", icon: User },
] as const;

export function CleanerBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 px-2 py-3 text-xs font-medium transition-colors",
                isActive ? "text-brand" : "text-gray-500 hover:text-gray-800"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
