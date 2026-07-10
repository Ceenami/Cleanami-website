import { Header } from "@/components/home/Header";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <>
      <Header />
      <div className="relative min-h-screen bg-gray-100 flex items-center justify-center antialiased">
      <div
        className="absolute inset-0 bg-cover bg-center z-0"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1558036117-15d82a90b9b1?q=80&w=2070&auto=format&fit=crop')" }}
      >
        <div className="absolute inset-0 bg-black/50"></div>
      </div>
      {children}
    </div>
    </>
  );
};