import { BadgeDollarSignIcon, ClipboardListIcon, CreditCardIcon, House, LayoutDashboard, LocateFixed, MailIcon, UserIcon, UsersIcon } from "lucide-react";

export const Logo = "https://ymccorozcd.ufs.sh/f/CFfiFeS2XelzZy5o0ZubBmJY75j80sif9WEVdIAGnpCtTSqr"
export const APP_NAME =
  "CleanNami - Airbnb & Vacation Rental Cleaning Services | Florida Coast";
export const APP_DESCRIPTION =
  "Premium **vacation rental cleaning** and residential services across Florida's coast. Specializing in efficient **same-day turnovers** and reliable **Airbnb cleaning** in New Smyrna Beach, Daytona Beach, and Edgewater.";

export const PUBLIC_NAV_ROUTES = [{ route: "/", title: "home" },
  { route: "/about", title: "about" }
];


export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000";

export const PRIVATE_ADMIN_NAV_ROUTES = [
  {
    icon: <LayoutDashboard />,
    label: "dashboard",
    route: "/admin/dashboard",
  },
  {
    icon: <House className="h-6 w-6" />,
    label: "my property",
    route: "/customer/dashboard",
  },
  {
    icon: <UsersIcon />,
    label: "cleaner mgmt",
    route: "/admin/cleaner-management",
  },
  {
    icon: <UsersIcon />,
    label: "cleaner invites",
    route: "/admin/cleaner-invitations",
  },
  {
    icon: <ClipboardListIcon />,
    label: "job Oversight",
    route: "/admin/job-oversight",
  },
  {
    icon: <UserIcon />,
    label: "customer Mgmt",
    route: "/admin/customer-management",
  },
  {
    icon: <House className="h-6 w-6" />,
    label: "properties",
    route: "/admin/properties",
  },
  {
    icon: <CreditCardIcon />,
    label: "subscriptions",
    route: "/admin/subscriptions",
  },
  {
    icon: <BadgeDollarSignIcon />,
    label: "Pricing",
    route: "/admin/pricing",
  },
  {
    icon: <LocateFixed />,
    label: "Follow Mee",
    route: "/admin/follow-mee",
  },
  // {
  //   icon: <Shield />,
  //   label: "disputes",
  //   route: "/admin/disputes",
  // },
  // {
  //   icon: <ChartBarIcon />,
  //   label: "reporting",
  //   route: "/admin/reporting",
  // },
  {
    icon: <MailIcon />,
    label: "notifications",
    route: "/admin/notifications",
  },
  // {
  //   icon: <CogIcon />,
  //   label: "settings & security",
  //   route: "/admin/settings",
  // },
  {
    icon: <LocateFixed />,
    label: "Geocode Addresses",
    route: "/admin/geocode",
  },
];

export const PRIVATE_USER_NAV_ROUTES = [
  {
    icon: <LayoutDashboard />,
    label: "dashboard",
    route: "/customer/dashboard",
  },
  {
    icon: <House className="h-6 w-6" />,
    label: "properties",
    route: "/customer/properties",
  },
  {
    icon: <CreditCardIcon />,
    label: "subscriptions",
    route: "/customer/subscriptions",
  },
  {
    icon: <UserIcon />,
    label: "account",
    route: "/customer/profile",
  },
];
