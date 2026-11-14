import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Study Helper",
  description: "Étudier, s'organiser, s'évaluer et progresser.",
  vérification:{
    Google:<meta name="google-site-verification" content="lcVWRQYBYh5lHVvIg_AfUQ9VvOT3X5a7Mf7Marh1Oe0" />
  }
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className={`${fraunces.variable} ${inter.variable} font-body`}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
