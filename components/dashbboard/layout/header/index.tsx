'use client'

import { SignOutButton } from "@/components/SignOutButton";
import { AdminNotificationsBell } from "@/components/dashbboard/layout/header/AdminNotificationsBell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ChevronDownIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

function prettifyPath(path: string) {
  // A regular expression to check if a string is a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return path
    .split('/') // Split the string by the slash
    .filter(Boolean) // Remove empty parts from the start
    .filter(part => !uuidRegex.test(part)) // Filter out any parts that are UUIDs
    .map(part =>
      part
        .split('-') // Handle kebab-case by splitting by hyphen
        .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
        .join(' ')
    )
    .join(' '); // Join the final parts with a space
}

export const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: user } = useCurrentUser();
  const activePage = usePathname();

  return (
    <header className="w-full h-20 bg-white border-b border-gray-200 flex md:items-center justify-end md:justify-between px-0 md:px-8">
      <div id="header-content-slide">
        <h2 className="text-xl font-semibold text-gray-800 transition-all duration-300 hidden md:block">{prettifyPath(activePage)}</h2>
      </div>
      <div className="flex items-center space-x-6">
        <AdminNotificationsBell />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center space-x-2 text-left p-1 rounded-md hover:bg-gray-100"
          >
            <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold">
              {user?.email?.charAt(0) ?? 'U'}
            </div>
            <div>
              <span className="text-sm font-medium block">
                {user?.email ?? ''}
              </span>
              <span className="text-xs text-gray-500 block">
                {user?.user_metadata.role ?? ''}
              </span>
            </div>
            <ChevronDownIcon className="h-4 w-4 text-gray-500" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
              <div className="py-1">
                <div className="px-4 py-2 text-xs text-gray-500 uppercase">
                  Switch User Role
                </div>
                {/* If adding more admins the super admin can see this */}
                {/* {adminUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      onSwitchUser(user.role);
                      setIsMenuOpen(false);
                    }}
                    className="w-full text-left flex justify-between items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <span>
                      {user.name}{" "}
                      <span className="text-gray-500">({user.role})</span>
                    </span>
                    {currentUser.id === user.id && (
                      <div className="w-2 h-2 rounded-full bg-teal-500"></div>
                    )}
                  </button>
                ))} */}
                <div className="border-t my-1"></div>
                <SignOutButton />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
