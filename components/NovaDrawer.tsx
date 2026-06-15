"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type JournalEntry = {
  id: string;
  day: string;             // ISO date, "yyyy-mm-dd"
  headline: string;        // one-line takeaway
  body: string;            // markdown-ish text (rendered as plain paragraphs for now)
  highlights: { ts: number; label: string }[]; // moments worth jumping to
  tags: ("stress" | "growth" | "environment" | "irrigation" | "light")[];
};

export type ChatTurn = { role: "user" | "nova"; text: string; ts: number };

const TAG_COLORS: Record<JournalEntry["tags"][number], string> = {
  stress: "#e24b4a",
  growth: "#1d9e75",
  environment: "#378add",
  irrigation: "#5dcaa5",
  light: "#ef9f27",
};

export default function NovaDrawer({
  open,
  onClose,
  entries,
  chat,
  thinking,
  onAsk,
  onJumpTo,
}: {
  open: boolean;
  onClose: () => void;
  entries: JournalEntry[];
  chat: ChatTurn[];
  thinking: boolean;
  onAsk: (text: string) => void;
  onJumpTo: (ts: number) => void;
}) {
  const [tab, setTab] = useState<"journal" | "ask">("journal");
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat to bottom when a new turn appears.
  useEffect(() => {
    if (tab === "ask" && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [tab, chat.length, thinking]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAsk(t);
    setDraft("");
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 180ms ease",
          zIndex: 40,
        }}
      />
      {/* Drawer */}
      <aside
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(440px, 100vw)",
          background: "#121212",
          borderLeft: "1px solid #242424",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms ease",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          color: "#eee",
        }}
      >
        <Header onClose={onClose} />
        <Tabs tab={tab} onTab={setTab} />

        {tab === "journal" ? (
          <JournalList entries={entries} onJumpTo={onJumpTo} />
        ) : (
          <AskPanel
            chat={chat}
            thinking={thinking}
            scrollerRef={scroller}
            draft={draft}
            setDraft={setDraft}
            onSubmit={submit}
          />
        )}
      </aside>
    </>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px",
        borderBottom: "1px solid #242424",
      }}
    >
      <NovaMark />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>Nova AI</div>
        <div style={{ fontSize: 11, color: "#888" }}>Daily journal & grow assistant</div>
      </div>
      <button onClick={onClose} aria-label="Close" style={iconBtn}>
        ✕
      </button>
    </div>
  );
}

function NovaMark() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: "linear-gradient(135deg, #7f77dd, #d4537e)",
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 500,
        color: "#fff",
      }}
      aria-hidden
    >
      ◆
    </div>
  );
}

function Tabs({
  tab,
  onTab,
}: {
  tab: "journal" | "ask";
  onTab: (t: "journal" | "ask") => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #242424" }}>
      {(["journal", "ask"] as const).map((t) => {
        const active = tab === t;
        return (
          <button
            key={t}
            onClick={() => onTab(t)}
            style={{
              flex: 1,
              background: "transparent",
              color: active ? "#eee" : "#888",
              border: "none",
              borderBottom: `2px solid ${active ? "#7f77dd" : "transparent"}`,
              padding: "10px 12px",
              fontSize: 13,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t === "journal" ? "Journal" : "Ask Nova"}
          </button>
        );
      })}
    </div>
  );
}

function JournalList({
  entries,
  onJumpTo,
}: {
  entries: JournalEntry[];
  onJumpTo: (ts: number) => void;
}) {
  if (entries.length === 0) {
    return (
      <div style={{ padding: 24, color: "#888", fontSize: 13 }}>
        Nova will write a daily journal entry once we wire her up.
      </div>
    );
  }
  return (
    <div style={{ overflowY: "auto", padding: "12px 16px 24px" }}>
      {entries.map((e) => (
        <article
          key={e.id}
          style={{
            borderBottom: "1px solid #1f1f1f",
            padding: "16px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <time style={{ fontSize: 11, color: "#888", letterSpacing: 0.3, textTransform: "uppercase" }}>
              {formatDay(e.day)}
            </time>
            <div style={{ flex: 1 }} />
            {e.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 10,
                  color: TAG_COLORS[t],
                  border: `1px solid ${TAG_COLORS[t]}55`,
                  background: `${TAG_COLORS[t]}11`,
                  borderRadius: 999,
                  padding: "2px 8px",
                  textTransform: "capitalize",
                }}
              >
                {t}
              </span>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: "0 0 6px", fontWeight: 500, lineHeight: 1.35 }}>
            {e.headline}
          </h3>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: "#bbb", margin: "0 0 10px" }}>
            {e.body}
          </p>
          {e.highlights.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {e.highlights.map((h, i) => (
                <button
                  key={i}
                  onClick={() => onJumpTo(h.ts)}
                  style={highlightBtn}
                  title={new Date(h.ts).toLocaleString()}
                >
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </article>
      ))}
      <div style={{ fontSize: 11, color: "#555", marginTop: 16 }}>
        Entries shown are placeholder. Nova writes real ones once the backend is wired.
      </div>
    </div>
  );
}

function AskPanel({
  chat,
  thinking,
  scrollerRef,
  draft,
  setDraft,
  onSubmit,
}: {
  chat: ChatTurn[];
  thinking: boolean;
  scrollerRef: React.RefObject<HTMLDivElement>;
  draft: string;
  setDraft: (s: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div ref={scrollerRef} style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {chat.length === 0 && !thinking && (
          <div style={{ color: "#888", fontSize: 13, padding: "8px 0" }}>
            Ask Nova about anything she's seen in the grow.
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setDraft(s)} style={suggestionBtn}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          <Bubble key={i} turn={m} />
        ))}
        {thinking && <Bubble turn={{ role: "nova", text: "thinking…", ts: Date.now() }} muted />}
      </div>
      <div
        style={{
          borderTop: "1px solid #242424",
          padding: 12,
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Ask Nova…"
          rows={2}
          style={{
            flex: 1,
            background: "#1a1a1a",
            color: "#eee",
            border: "1px solid #2a2a2a",
            borderRadius: 8,
            padding: "8px 10px",
            fontFamily: "inherit",
            fontSize: 13,
            resize: "none",
          }}
        />
        <button onClick={onSubmit} disabled={!draft.trim()} style={sendBtn}>
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ turn, muted = false }: { turn: ChatTurn; muted?: boolean }) {
  const isUser = turn.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        margin: "6px 0",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "#1f1f1f" : "#16151f",
          border: `1px solid ${isUser ? "#2a2a2a" : "#2a2a3a"}`,
          color: muted ? "#888" : "#eee",
          padding: "8px 10px",
          borderRadius: 10,
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {turn.text}
      </div>
    </div>
  );
}

function formatDay(d: string) {
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

const SUGGESTIONS = [
  "What's the most stressed the plants looked this week?",
  "When was VPD last above 1.5 kPa?",
  "Has canopy growth slowed?",
  "Anything unusual in the last 24 hours?",
];

const iconBtn: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "1px solid #2a2a2a",
  borderRadius: 6,
  width: 28,
  height: 28,
  cursor: "pointer",
  fontSize: 13,
};

const highlightBtn: React.CSSProperties = {
  background: "#1a1a1a",
  color: "#bbb",
  border: "1px solid #2a2a2a",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};

const suggestionBtn: React.CSSProperties = {
  background: "#161616",
  color: "#bbb",
  border: "1px solid #242424",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  textAlign: "left",
  cursor: "pointer",
};

const sendBtn: React.CSSProperties = {
  background: "#7f77dd",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  cursor: "pointer",
  height: 36,
};
