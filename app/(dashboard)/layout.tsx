import { Header } from "@/components/dashbboard/layout/header";
import { Sidebar } from "@/components/dashbboard/layout/sidebar";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="min-w-0 flex-1 pt-16 md:pt-0">
        <Header />
        <main
          id="slide-content"
          className="min-h-[calc(100svh-4rem)] overflow-x-hidden bg-gray-50 px-4 py-6 sm:px-6 md:min-h-screen md:px-8 md:py-8"
        >
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
