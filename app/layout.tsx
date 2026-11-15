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

export const metadata = {
  title: "StudyHelper - Aide aux devoirs et révision pour étudiants",
  description: "StudyHelper t'aide à réviser, comprendre tes cours et faire tes devoirs plus vite. Application pour étudiants au Cameroun et en Afrique.",
  keywords: ["studyhelper", "aide etude", "aide devoir", "revision bac"],
  authors: [{ name: "StudyHelper" }],
  openGraph: {
    url: "https://studyhelper-lovat.vercel.app",
    siteName: "StudyHelper",
  verification:{
    google:"lcVWRQYBYh5lHVvIg_AfUQ9VvOT3X5a7Mf7Marh1Oe0", 
  }, 
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
