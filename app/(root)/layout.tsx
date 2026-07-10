import { Header } from "@/components/home/Header";
import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/lib/constants";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="bg-white text-gray-800 antialiased">
      <Header />
      {children}

      <footer className="bg-gray-50 border-t border-gray-100 pt-16 pb-8">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-gray-200 pb-12">
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-brand">CleanNami</h3>
              <p className="text-gray-600 text-sm">
                Dedicated to providing spotless clean and exceptional service.
              </p>
              <div className="flex flex-col space-y-1 text-sm text-gray-700">
                <a
                  href="mailto:cleannami@ceenami.com"
                  className="hover:text-brand transition-colors duration-200 flex items-center"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 4v7a2 2 0 002 2h14a2 2 0 002-2v-7"
                    ></path>
                  </svg>
                  cleannami@ceenami.com
                </a>
                <a
                  href="tel:407-708-8643"
                  className="hover:text-brand transition-colors duration-200 flex items-center"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    ></path>
                  </svg>
                  407-708-8643
                </a>
              </div>
            </div>

            {/* Column 2: Quick Links */}
            <div className="md:col-span-1">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">
                Quick Links
              </h4>
              <nav className="flex flex-col space-y-2">
                <Link
                  href="/"
                  className="text-gray-600 hover:text-brand transition-colors duration-200 text-sm"
                >
                  Home
                </Link>
                <Link
                  href="/about"
                  className="text-gray-600 hover:text-brand transition-colors duration-200 text-sm"
                >
                  About Us
                </Link>
                {/* Add more links here if needed, e.g., /services, /contact */}
              </nav>
            </div>

            {/* Column 3: Newsletter/Social (Placeholder) */}
            <div className="m-auto">
              <Image
                src={Logo}
                width={400}
                height={400}
                alt="cleannami logo"
                className="bg-brand  rounded-t-full overflow-hidden"
              />
              {/* <h4 className="text-lg font-semibold text-gray-900 mb-4">Stay Connected</h4>
                <p className="text-sm text-gray-600">Follow us on social media for updates and offers!</p>
                <div className="flex space-x-4 mt-3">
                    <div className="w-8 h-8 rounded-full bg-brand/10 hover:bg-brand/20 transition-colors duration-200 flex items-center justify-center text-brand/70">
                        <span className="font-bold text-xs">S1</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-brand/10 hover:bg-brand/20 transition-colors duration-200 flex items-center justify-center text-brand/70">
                        <span className="font-bold text-xs">S2</span>
                    </div>
                </div> */}
            </div>
          </div>

          {/* Copyright and Credits */}
          <div className="pt-6 flex flex-col md:flex-row justify-between items-center text-sm text-gray-500">
            <p className="order-2 md:order-1 mt-4 md:mt-0">
              &copy; {new Date().getFullYear()} **CleanNami**. All rights
              reserved.
            </p>
            <p className="order-1 md:order-2">
              Built by{" "}
              <a
                href="https://trotchiedigital.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-brand font-medium transition-colors duration-200"
              >
                Trotchie Digital Solutions
              </a>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
