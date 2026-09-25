export const btn: React.CSSProperties = {
  background: "#1f1f1f",
  color: "#eee",
  border: "1px solid #333",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
};

export const inputStyle: React.CSSProperties = {
  background: "#1a1a1a",
  color: "#eee",
  border: "1px solid #333",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  colorScheme: "dark",
};

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#888", textAlign: "center" }}>
      <div>{children}</div>
    </div>
  );
}
