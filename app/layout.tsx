import "./globals.css";

export const metadata = {
  title: "Plant Health AI",
  description:
    "Time-lapse cameras paired with your Growlink sensor data. Watch the canopy change alongside temperature, humidity and VPD.",
};

export const viewport = { themeColor: "#080b0a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
