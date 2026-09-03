/**
 * Site identity: the `<title>` and the meta description.
 *
 * A plain `.ts` module, like `./contact`. `lib/constants/index.tsx` is TSX and
 * exports nav arrays holding `<LayoutDashboard />` elements, so importing
 * anything from it pulls React and lucide-react into the importer's module
 * graph — harmless in a component, wrong for `app/layout.tsx`'s metadata and
 * fatal outside a JSX runtime (it is what made the M6/M7 verifier crash).
 *
 * Counterproposal item 1: both of these used to name Airbnb and vacation
 * rentals only, which is what a search result showed a homeowner looking for a
 * house cleaner.
 */
export const APP_NAME =
  "CleanNami - Vacation Rental Turnovers & Home Cleaning | Florida Coast";

export const APP_DESCRIPTION =
  "Vacation rental turnover cleaning on autopilot, and one-time residential house cleaning booked online, across Florida's coast — New Smyrna Beach, Daytona Beach and Edgewater. Transparent pricing, vetted cleaners, no hidden fees.";
