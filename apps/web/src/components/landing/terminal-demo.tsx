"use client";

import { useState, useEffect } from "react";

interface TerminalLine {
  text: string;
  type: "prompt" | "status" | "result" | "summary" | "action";
}

const examples: { prompt: string; lines: TerminalLine[] }[] = [
  {
    prompt: "add the contacts from yesterday's BioFach meetings to the CRM",
    lines: [
      { text: "Found 4 contacts in your meeting notes.", type: "status" },
      { text: "Creating records in N&E Innovations CRM...", type: "status" },
      { text: "", type: "status" },
      { text: "done  Sarah Chen, Hilton", type: "result" },
      { text: "done  Alex Dumont, Marriott", type: "result" },
      { text: "done  Omar Hassan, Sodexo", type: "result" },
      { text: "done  Priya Shah, Bunzl", type: "result" },
      { text: "", type: "status" },
      { text: "All 4 linked to BioFach 2026. Want me to create follow-up tasks?", type: "action" },
    ],
  },
  {
    prompt: "show me all leads in the Proposal stage this month",
    lines: [
      { text: "Querying N&E Innovations CRM...", type: "status" },
      { text: "", type: "status" },
      { text: "4 leads in Proposal stage:", type: "summary" },
      { text: "  Hilton — Europe (Quotation Sent, €89k)", type: "result" },
      { text: "  Marriott — APAC (Proposal Sent, €156k)", type: "result" },
      { text: "  Sodexo — France (Quotation Sent, €67k)", type: "result" },
      { text: "  Bunzl — UK (Proposal Sent, €112k)", type: "result" },
      { text: "", type: "status" },
      { text: "Total pipeline: €424k", type: "summary" },
    ],
  },
  {
    prompt: "add a note to the Sodexo lead about today's call",
    lines: [
      {
        text: 'Added note to Sodexo (Quotation Sent, €67k):',
        type: "status",
      },
      {
        text: '"Call with procurement team — requested revised quote',
        type: "result",
      },
      {
        text: ' with volume tiers. Decision expected end of month."',
        type: "result",
      },
      { text: "", type: "status" },
      {
        text: "Done. Want me to create a task to send the revised quote?",
        type: "action",
      },
    ],
  },
];

export function TerminalDemo() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [visibleLines, setVisibleLines] = useState(0);
  const [promptVisible, setPromptVisible] = useState(false);
  const [fading, setFading] = useState(false);

  const example = examples[exampleIndex];

  useEffect(() => {
    // Phase 1: Show prompt
    setPromptVisible(false);
    setVisibleLines(0);
    setFading(false);

    const promptTimer = setTimeout(() => {
      setPromptVisible(true);
    }, 300);

    // Phase 2: Show response lines one by one
    const lineTimers: ReturnType<typeof setTimeout>[] = [];
    const baseDelay = 1200; // after prompt appears

    example.lines.forEach((_, i) => {
      const timer = setTimeout(
        () => {
          setVisibleLines(i + 1);
        },
        baseDelay + (i + 1) * 200
      );
      lineTimers.push(timer);
    });

    // Phase 3: Hold, then fade and advance
    const holdTime = baseDelay + (example.lines.length + 1) * 200 + 2500;
    const fadeTimer = setTimeout(() => {
      setFading(true);
    }, holdTime);

    const advanceTimer = setTimeout(() => {
      setExampleIndex((i) => (i + 1) % examples.length);
    }, holdTime + 600);

    return () => {
      clearTimeout(promptTimer);
      lineTimers.forEach(clearTimeout);
      clearTimeout(fadeTimer);
      clearTimeout(advanceTimer);
    };
  }, [exampleIndex, example.lines.length]);

  return (
    <div
      className="w-full font-mono text-[13px] leading-[1.7] sm:text-[14px] transition-opacity duration-500"
      style={{ opacity: fading ? 0 : 1 }}
    >
      {/* User command */}
      <div
        className="transition-opacity duration-300"
        style={{ opacity: promptVisible ? 1 : 0 }}
      >
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-indigo-400/70">
          you
        </div>
        <div className="pl-3 border-l-2 border-white/10">
          <span className="text-white font-medium">
            {example.prompt}
          </span>
        </div>
      </div>

      {/* Bot response */}
      <div className="mt-5 space-y-0">
        <div
          className="mb-2 text-[11px] font-medium uppercase tracking-widest text-emerald-400/70 transition-all duration-300"
          style={{
            opacity: visibleLines > 0 ? 1 : 0,
            transform: visibleLines > 0 ? "translateY(0)" : "translateY(4px)",
          }}
        >
          AI agent
        </div>
        <div className="pl-3 border-l-2 border-white/[0.06] space-y-0">
        {example.lines.map((line, i) => (
          <div
            key={`${exampleIndex}-${i}`}
            className="transition-all duration-300"
            style={{
              opacity: i < visibleLines ? 1 : 0,
              transform:
                i < visibleLines ? "translateY(0)" : "translateY(4px)",
            }}
          >
            {line.text === "" ? (
              <div className="h-2" />
            ) : line.type === "result" && line.text.startsWith("done") ? (
              <div>
                <span className="text-emerald-400">{"done"}</span>
                <span className="text-white/60">
                  {line.text.slice(4)}
                </span>
              </div>
            ) : line.type === "result" ? (
              <div className="text-white/60">
                {line.text}
              </div>
            ) : line.type === "summary" ? (
              <div className="text-white/80 font-medium">
                {line.text}
              </div>
            ) : line.type === "action" ? (
              <div className="text-white/70">
                {line.text}
              </div>
            ) : (
              <div className="text-white/50">
                {line.text}
              </div>
            )}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
