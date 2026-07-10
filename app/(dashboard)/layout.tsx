import { Header } from "@/components/dashbboard/layout/header";
import { Sidebar } from "@/components/dashbboard/layout/sidebar";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-screen">
      <Header />
      <Sidebar />
      <main id="slide-content" className="min-h-screen flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-8 transition-all duration-300">
        {children}
      </main>
    </div>
  );
}