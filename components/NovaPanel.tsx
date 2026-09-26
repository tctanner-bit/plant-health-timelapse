"use client";

import { useEffect, useRef, useState } from "react";
import type { Insight, InsightObservation } from "../lib/api";

// Nova's insights for one camera: daily reviews (made automatically, shared
// with the org) and on-demand looks at a single frame. Every observation
// cites its frames, which jump the timelapse to that moment.

const CATEGORY: Record<string, string> = {
  growth: "Growth",
  stress: "Stress",
  pest_disease: "Pest / disease",
  irrigation: "Irrigation",
  environment: "Environment",
  light: "Light",
  image_quality: "Image",
};

const CONCERN_LABEL = { none: "Looks good", watch: "Watch", action: "Action" } as const;
const CONCERN_TONE = { none: "ok", watch: "warn", action: "alarm" } as const;

export default function NovaPanel({
  open,
  onClose,
  insights,
  loading,
  dailyBusy,
  currentTs,
  onAsk,
  onJumpTo,
}: {
  open: boolean;
  onClose: () => void;
  insights: Insight[] | null;
  loading: boolean;
  dailyBusy: string | null; // label of the day being reviewed right now
  currentTs: number | null;
  onAsk: (question: string) => Promise<void>;
  onJumpTo: (ts: number) => void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const ask = async () => {
    setAsking(true);
    setAskError(null);
    try {
      await onAsk(question);
      setQuestion("");
    } catch (e: any) {
      setAskError(e.message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <div className="nova-scrim" data-open={open} onClick={onClose} />
      <aside ref={panel} className="nova-panel" data-open={open} aria-hidden={!open} aria-label="Nova insights" tabIndex={-1}>
        <div className="nova-head">
          <span className="nova-mark" aria-hidden>◆</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Nova insights</div>
            <div className="small muted">Frames read against this room&apos;s sensor data</div>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close Nova">✕</button>
        </div>

        <div className="nova-scroll">
          <section className="nova-ask">
            <div className="eyebrow">Ask about this frame</div>
            <div className="small muted" style={{ margin: "4px 0 10px" }}>
              {currentTs
                ? new Date(currentTs).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : "Pick a frame in the timelapse first"}
            </div>
            <textarea
              className="field"
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Optional: what should Nova look at? e.g. Is the top canopy drooping?"
              maxLength={500}
              style={{ resize: "vertical", minHeight: 64 }}
            />
            <button className="btn nova" style={{ marginTop: 10, width: "100%" }} disabled={!currentTs || asking} onClick={ask}>
              {asking ? "Nova is looking…" : "Analyze this frame"}
            </button>
            {askError && <div className="error-text" style={{ marginTop: 8 }}>{askError}</div>}
          </section>

          {dailyBusy && (
            <div className="nova-card" aria-live="polite">
              <div className="eyebrow">Daily review · {dailyBusy}</div>
              <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>Nova is reviewing the day&apos;s frames…</div>
            </div>
          )}

          {loading && !insights ? (
            <div className="muted small" style={{ padding: 20 }}>Loading insights…</div>
          ) : insights && insights.length === 0 && !dailyBusy ? (
            <div className="muted" style={{ padding: "20px 4px", fontSize: 14, lineHeight: 1.5 }}>
              No insights yet. Nova writes a daily review once a camera has a full day of frames, and you can ask
              about any frame above.
            </div>
          ) : (
            insights?.filter((i) => i.status !== "running" || i.kind === "moment").map((i) => (
              <InsightCard key={i.id} insight={i} onJumpTo={onJumpTo} />
            ))
          )}

          <p className="small" style={{ color: "var(--dim)", margin: "16px 4px 8px", lineHeight: 1.5 }}>
            AI-generated from camera frames and sensor data. Confirm anything important in the room.
          </p>
        </div>
      </aside>
    </>
  );
}

function InsightCard({ insight: i, onJumpTo }: { insight: Insight; onJumpTo: (ts: number) => void }) {
  const title =
    i.kind === "daily"
      ? `Daily review · ${i.day ? new Date(i.day + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : ""}`
      : `Frame · ${new Date(i.periodEnd).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;

  if (i.status === "running") {
    return (
      <div className="nova-card">
        <div className="eyebrow">{title}</div>
        <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>Nova is looking…</div>
      </div>
    );
  }
  if (i.status === "failed") {
    return (
      <div className="nova-card">
        <div className="eyebrow">{title}</div>
        <div className="small" style={{ marginTop: 8, color: "var(--warn)" }}>{i.error ?? "Nova couldn't finish this one."}</div>
      </div>
    );
  }

  const tone = CONCERN_TONE[i.concern ?? "none"];
  return (
    <article className={`nova-card concern-${tone}`}>
      <div className="row" style={{ gap: 10 }}>
        <div className="eyebrow" style={{ flex: 1 }}>{title}</div>
        <span className={`status ${tone}`}>{CONCERN_LABEL[i.concern ?? "none"]}</span>
      </div>
      {i.question && <div className="small muted" style={{ marginTop: 8 }}>“{i.question}”</div>}
      <h3 className="nova-headline">{i.headline}</h3>

      {i.observations.length > 0 && (
        <ul className="nova-obs">
          {i.observations.map((o, k) => <ObservationItem key={k} o={o} onJumpTo={onJumpTo} />)}
        </ul>
      )}

      {i.suggestions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Suggested checks</div>
          <ul className="nova-suggest">
            {i.suggestions.map((s, k) => <li key={k}>{s}</li>)}
          </ul>
        </div>
      )}

      {i.confidence && (
        <div className="small" style={{ color: "var(--dim)", marginTop: 10 }}>Confidence: {i.confidence}</div>
      )}
    </article>
  );
}

function ObservationItem({ o, onJumpTo }: { o: InsightObservation; onJumpTo: (ts: number) => void }) {
  const tone = CONCERN_TONE[o.concern] ?? "ok";
  return (
    <li className={`obs obs-${tone}`}>
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <span className="obs-cat">{CATEGORY[o.category] ?? o.category}</span>
        {o.sensors.length > 0 && <span className="small muted">· {o.sensors.join(", ")}</span>}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{o.text}</div>
      {o.frames.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {o.frames.map((f) => (
            <button key={f.id} className="chip" onClick={() => onJumpTo(f.ts)} title="Show this frame">
              {new Date(f.ts).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
