export const metadata = { title: "Plant Health Timelapse" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#111", color: "#eee" }}>
        {children}
      </body>
    </html>
  );
}
