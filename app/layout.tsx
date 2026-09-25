export const metadata = {
  title: "Plant Health AI",
  description:
    "Time-lapse cameras paired with your Growlink sensor data. Watch the canopy change alongside temperature, humidity and VPD.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#111", color: "#eee" }}>
        {children}
      </body>
    </html>
  );
}
