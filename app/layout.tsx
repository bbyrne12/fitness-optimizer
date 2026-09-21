import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// The canonical address, for link previews. VERCEL_URL is the one-off
// deployment hostname, which a preview card must not point at, so the
// project's production domain wins.
const defaultUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

const TITLE = "Fitness Optimizer — one training decision every morning";
const DESCRIPTION =
  "Reads your WHOOP recovery each morning and emails one prescription for the day: " +
  "what to train, how hard, and at what loads. Learns what each kind of session costs you.";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: TITLE, template: "%s · Fitness Optimizer" },
  description: DESCRIPTION,
  applicationName: "Fitness Optimizer",
  keywords: ["WHOOP", "recovery", "HRV", "training plan", "strength training", "running"],
  openGraph: {
    type: "website",
    siteName: "Fitness Optimizer",
    title: TITLE,
    description: DESCRIPTION,
    url: defaultUrl,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  // The home-screen label, which would otherwise be the whole long title.
  // Not "capable": a standalone web app on iOS hands cross-origin navigation
  // back to Safari, which would strand anyone mid-way through WHOOP's OAuth.
  appleWebApp: { capable: false, title: "Optimizer" },
};

export const viewport: Viewport = { themeColor: "#09090b" };

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
