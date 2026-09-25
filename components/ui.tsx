// Small shared pieces. Styling lives in app/globals.css.

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="center-screen">
      <div>{children}</div>
    </div>
  );
}

export function Brand() {
  return (
    <span className="brand eyebrow">
      <span className="brand-mark" aria-hidden />
      Plant Health AI
    </span>
  );
}
