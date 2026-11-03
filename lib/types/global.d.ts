declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...command: unknown[]) => void;
  }
}

export {};
