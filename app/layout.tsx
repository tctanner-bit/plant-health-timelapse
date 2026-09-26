import "./globals.css";

export const metadata = {
  title: "Plant Health AI",
  description:
    "Time-lapse cameras paired with your Growlink sensor data. Watch the canopy change alongside temperature, humidity and VPD.",
  // Builder hands the API key over in the first URL; never let a full URL
  // leak to other sites through the Referer header.
  referrer: "strict-origin" as const,
};

export const viewport = { themeColor: "#080b0a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
