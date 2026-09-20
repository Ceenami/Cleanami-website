/**
 * Customer-facing support address.
 *
 * It lives here rather than in `lib/constants/index.tsx` because that file is
 * TSX — it exports nav arrays holding `<LayoutDashboard />` elements — so
 * importing anything from it pulls React and lucide-react into the importer's
 * module graph. Harmless in a component; wrong in `email.service.ts`, which is
 * a server module and which crashed outright when the verifier loaded it
 * outside a JSX runtime. One constant, one plain module.
 */
export const SUPPORT_EMAIL = "cleannami@ceenami.com";
