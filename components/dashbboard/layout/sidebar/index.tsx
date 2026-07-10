"use client";
import React, { useEffect, useState } from "react";
import { Menu, X, Play, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PRIVATE_ADMIN_NAV_ROUTES, PRIVATE_USER_NAV_ROUTES } from "@/lib/constants";
import Link from "next/link";
import { Route } from "next";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AssignmentResult {
  jobId: string;
  status: "assigned" | "skipped";
  reason?: string;
  assignments?: {
    primary?: string;
    backup?: string;
  };
}

interface AssignmentResponse {
  success: boolean;
  message?: string;
  summary?: {
    totalProcessed: number;
    assigned: number;
    skipped: number;
  };
  results?: AssignmentResult[];
  error?: string;
}

export const Sidebar = () => {
  const { data: user } = useCurrentUser();

  const pathname = usePathname()

  const [isOpen, setIsOpen] = useState(false);
  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  const visibleNavItems = user?.user_metadata.role === 'admin' || user?.user_metadata.role === 'super_admin' ? PRIVATE_ADMIN_NAV_ROUTES : PRIVATE_USER_NAV_ROUTES;
  const isAdmin =
    user?.user_metadata?.role === "admin" ||
    user?.user_metadata?.role === "super_admin";


  useEffect(() => {
    const html = document.documentElement;
    if (isOpen) {
      html.classList.add("sidebar-open");
    } else {
      html.classList.remove("sidebar-open");
    }
  }, [isOpen]);

  const sidebarPositionClass = isOpen ? "translate-x-0" : "-translate-x-full";
  const tabVisibilityClass = isOpen ? "hidden" : "block";


const [availabilityBypass, setAvailabilityBypass] = useState(false)
const [bypassLoading, setBypassLoading] = useState(true)

useEffect(() => {
  if (!isAdmin) {
    setBypassLoading(false);
    return;
  }

  const supabase = createClient()
  
  const fetchBypass = async () => {
    const { data } = await (supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'availability_bypass')
      .single()) as { data: { value: boolean } | null }
    
    setAvailabilityBypass(data?.value ?? false)
    setBypassLoading(false)
  }
  
  fetchBypass()
  
  const channel = supabase
    .channel('app_settings_bypass')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'app_settings',
        filter: 'key=eq.availability_bypass'
      },
      (payload: any) => {
        setAvailabilityBypass(payload.new?.value ?? false)
      }
    )
    .subscribe()
  
  return () => {
    supabase.removeChannel(channel)
  }
}, [isAdmin])

const toggleAvailabilityBypass = async () => {
  const supabase = createClient()
  const newValue = !availabilityBypass
  setAvailabilityBypass(newValue) 
  
  const { error } = await (supabase
    .from('app_settings')
    .update({ value: newValue, updated_at: new Date().toISOString() })
    .eq('key', 'availability_bypass')) as { error: any }
  
  if (error) {
    setAvailabilityBypass(!newValue) 
    console.error('Failed to toggle bypass:', error)
  }
}

// Assignment Engine State
const [assignmentLoading, setAssignmentLoading] = useState(false)
const [assignmentResult, setAssignmentResult] = useState<AssignmentResponse | null>(null)

const triggerAssignmentEngine = async () => {
  setAssignmentLoading(true)
  setAssignmentResult(null)

  try {
    const response = await fetch("/api/trigger-assignments", {
      method: "POST",
    })

    const data: AssignmentResponse = await response.json()
    setAssignmentResult(data)

    // Auto-clear success message after 5 seconds
    if (data.success) {
      setTimeout(() => setAssignmentResult(null), 5000)
    }
  } catch {
    setAssignmentResult({ success: false, error: "Network error" })
  } finally {
    setAssignmentLoading(false)
  }
}

  return (
    <>
      <aside
        className={`fixed inset-y-0 md:top-20 md:absolute left-0 w-64 bg-white shadow-lg flex flex-col transition-transform duration-300 ease-in-out z-50 md:h-full ${sidebarPositionClass}`}
      >
        <div className="h-20 flex items-center justify-between border-b border-gray-200 px-4">
          <h1 className="text-2xl font-extrabold text-gray-800 tracking-tight">
            <span className="text-teal-500">Clean</span>Nami
            {isAdmin && (
              <span className="block text-xs font-semibold text-gray-500 tracking-widest -mt-1">
                ADMIN
              </span>
            )}
            {!isAdmin && user?.user_metadata?.role === "user" && (
              <span className="block text-xs font-semibold text-gray-500 tracking-widest -mt-1">
                OWNER
              </span>
            )}
          </h1>
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="flex-1 px-0 py-0 h-full space-y-2 bg-teal-50 ">
          <div className="p-0 bg-gray-50 rounded-lg text-sm text-gray-600">
            {visibleNavItems.map((item) => (
              <Link
                key={item.label}
                href={item.route as Route}
                className={`flex items-center w-full px-4 py-2.5 text-sm font-medium text-gray-600 rounded-lg transition-colors duration-200 text-left ${
                  pathname?.startsWith(item.route)
                    ? "text-teal-700"
                    : "hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {item.icon}
                <span className="ml-3">{item.label}</span>
              </Link>
            ))}
          </div>

{isAdmin && (
<div className="mt-4 p-4 bg-gray-50 rounded-lg">
  <div className="flex items-center justify-between">
    <div className="flex-1">
      <p className="text-sm font-medium text-gray-700">Availability Bypass</p>
      <p className="text-xs text-gray-500">Allow submissions anytime</p>
    </div>
    <button
      onClick={toggleAvailabilityBypass}
      disabled={bypassLoading}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        availabilityBypass ? 'bg-teal-600' : 'bg-gray-300'
      } ${bypassLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          availabilityBypass ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </div>
</div>
)}

{isAdmin && (
<div className="mt-4 p-4 bg-gray-50 rounded-lg">
  <div className="space-y-2">
    <div className="flex-1">
      <p className="text-sm font-medium text-gray-700">Assignment Engine</p>
      <p className="text-xs text-gray-500">Assign cleaners to unassigned jobs</p>
    </div>
    <button
      onClick={triggerAssignmentEngine}
      disabled={assignmentLoading}
      className={`flex items-center justify-center gap-2 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        assignmentLoading
          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
          : 'bg-teal-600 text-white hover:bg-teal-700'
      }`}
    >
      {assignmentLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Running...
        </>
      ) : (
        <>
          <Play className="w-4 h-4" />
          Run Now
        </>
      )}
    </button>
    
    {/* Result feedback */}
    {assignmentResult && (
      <div className={`text-xs p-2 rounded ${
        assignmentResult.success 
          ? 'bg-green-50 text-green-700' 
          : 'bg-red-50 text-red-700'
      }`}>
        {assignmentResult.error ? (
          assignmentResult.error
        ) : assignmentResult.message ? (
          assignmentResult.message
        ) : assignmentResult.summary ? (
          <span>
            {assignmentResult.summary.assigned} assigned, {assignmentResult.summary.skipped} skipped
          </span>
        ) : null}
      </div>
    )}
  </div>
</div>
)}
        </nav>
      </aside>

      <button
        onClick={toggleSidebar}
        className={`fixed top-8 left-0 p-3 bg-teal-500 text-white rounded-r-lg shadow-md hover:bg-teal-600 transition-colors z-40 ${tabVisibilityClass}`}
        aria-label="Open sidebar"
      >
        <Menu className="w-6 h-6" />
      </button>

      {isOpen && (
        <div
          onClick={toggleSidebar}
          className="fixed inset-0 bg-black opacity-50 z-40 md:hidden"
          aria-hidden="true"
        ></div>
      )}
    </>
  );
};