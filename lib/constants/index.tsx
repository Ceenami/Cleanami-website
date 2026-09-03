import { BadgeDollarSignIcon, CalendarPlusIcon, ClipboardListIcon, CreditCardIcon, House, LayoutDashboard, LocateFixed, MailIcon, PackageIcon, Shield, TicketPercentIcon, UserIcon, UsersIcon } from "lucide-react";

export const Logo = "https://ymccorozcd.ufs.sh/f/CFfiFeS2XelzZy5o0ZubBmJY75j80sif9WEVdIAGnpCtTSqr"
/**
 * The `<title>` and meta description. Defined in `./app` (a plain .ts module)
 * and re-exported here so existing `@/lib/constants` imports are unaffected.
 * Server and non-JSX callers should import from `@/lib/constants/app` directly.
 */
export { APP_NAME, APP_DESCRIPTION } from "./app";

export const PUBLIC_NAV_ROUTES = [{ route: "/", title: "home" },
  { route: "/about", title: "about" }
];


export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000";

/**
 * Customer-facing support address. Property details are maintained by CleanNami
 * rather than edited by customers (Remaining Tasks Phase 5), so this is the
 * route a customer takes to get a property changed.
 *
 * Defined in `./contact` (a plain .ts module) and re-exported here so existing
 * `@/lib/constants` imports are unaffected. Server modules should import it
 * from `@/lib/constants/contact` directly — this file is TSX and carries React.
 */
export { SUPPORT_EMAIL } from "./contact";

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
    icon: <TicketPercentIcon />,
    label: "promo codes",
    route: "/admin/promo-codes",
  },
  {
    icon: <PackageIcon />,
    label: "restocking",
    route: "/admin/restocking",
  },
  {
    icon: <LocateFixed />,
    label: "Follow Mee",
    route: "/admin/follow-mee",
  },
  {
    icon: <Shield />,
    label: "disputes",
    route: "/admin/disputes",
  },
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
    icon: <CalendarPlusIcon />,
    label: "book a clean",
    route: "/customer/book",
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
