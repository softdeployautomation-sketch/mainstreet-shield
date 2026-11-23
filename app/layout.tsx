import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MainStreet Shield",
  description:
    "MainStreet Shield — real Linux lab console with Cline agent access and human-operated security workflows.",
};

const themeScript = `
(() => {
  const STORAGE_KEY = "ms-theme";
  const DEFAULT = "dark";
  const root = document.documentElement;

  function setTheme(theme: string) {
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }

  function initTheme() {
    let theme = DEFAULT;
    try { theme = localStorage.getItem(STORAGE_KEY) ?? DEFAULT; } catch {}
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param === "dark" || param === "light") theme = param;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches && !localStorage.getItem(STORAGE_KEY)) theme = "dark";
    setTheme(theme);
  }

  initTheme();
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        ></script>
      </head>
      <body className={`${geist.variable} ${geistMono.variable} bg-bg text-fg min-h-screen selection:bg-brand-200 selection:text-fg`}>
        {children}
      </body>
    </html>
  );
}