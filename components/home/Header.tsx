"use client";

import Link from "next/link";
import { useState } from "react";
import localFont from 'next/font/local';



const myFont = localFont({
      src: [
        {
          path: '../../public/fonts/Arkhip_font.ttf',
          weight: '400',
          style: 'normal',
        },
      ],
      variable: '--font-arkhip-font', // Optional: for use with Tailwind CSS
      display: 'swap',
    });

export const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <>
      {/* The header container */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-sm shadow-sm">
        {/* Main header content */}
        <div className="container mx-auto flex justify-between items-center p-4 ">
          <Link
            href="/"
            className={`text-3xl font-extrabold ${myFont.className} antialiased text-brand/60 tracking-tight flex flex-row my-auto`}
          >
            {/* className="text-teal-500" */}
            
            <span className='text-brand' >Clean</span>Nami
            
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-8">
            <Link
              href="/"
              className="text-gray-600 hover:text-brand font-medium transition-colors"
            >
              Home
            </Link>
            <Link
              href="/about"
              className="text-gray-600 hover:text-brand font-medium transition-colors"
            >
              About Us
            </Link>
            <Link
              href="/sign-in"
              className="text-gray-600 hover:text-brand font-medium transition-colors"
            >
              Sign in
            </Link>
          </nav>

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-gray-800 hover:text-teal-500 focus:outline-none"
              aria-label="Toggle menu"
            >
              {isMenuOpen ? (
                // Close (X) icon
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  ></path>
                </svg>
              ) : (
                // Hamburger icon
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16m-7 6h7"
                  ></path>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {/* This div's visibility is controlled by the isMenuOpen state */}
        <div className={`md:hidden ${isMenuOpen ? "block" : "hidden"}`}>
          <nav className="flex flex-col items-center space-y-4 p-5 bg-white border-t border-gray-200">
            <Link
              href="/"
              className="text-gray-600 hover:text-teal-500 font-medium transition-colors"
              onClick={() => setIsMenuOpen(false)} // Close menu on link click
            >
              Home
            </Link>
            <Link
              href="/about"
              className="text-gray-600 hover:text-teal-500 font-medium transition-colors"
              onClick={() => setIsMenuOpen(false)} // Close menu on link click
            >
              About Us
            </Link>
            <Link
              href="/sign-in"
              className="text-gray-600 hover:text-teal-500 font-medium transition-colors"
              onClick={() => setIsMenuOpen(false)} // Close menu on link click
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
};
