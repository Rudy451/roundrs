import "./globals.css";
import { Libre_Baskerville, DM_Sans, DM_Mono } from "next/font/google";

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight:  "400",
  style:   "italic",
  variable: "--font-display",
  display:  "swap",
});

const dmSans = DM_Sans({
  subsets:  ["latin"],
  variable: "--font-ui",
  display:  "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight:  "400",
  variable: "--font-data",
  display:  "swap",
});

export const metadata = {
  title: "The Peanut Gallery",
  description: "DraftBoard investment discovery engine",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${libreBaskerville.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
