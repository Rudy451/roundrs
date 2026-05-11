import "./globals.css";

export const metadata = {
  title: "The Peanut Gallery",
  description: "DraftBoard investment discovery engine",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
