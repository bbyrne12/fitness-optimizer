import { ImageResponse } from "next/og";

// The link preview: what a reviewer sees before the page loads.
export const alt = "Fitness Optimizer — one training decision every morning, from your WHOOP recovery";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "center", padding: "72px 80px",
          background: "#09090b", color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, color: "#a3e635", fontSize: 24, letterSpacing: 4 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#a3e635" }} />
          FITNESS OPTIMIZER
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
          <span>One training decision,</span>
          <span style={{ color: "#a3e635" }}>every morning.</span>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: "#a1a1aa", maxWidth: 900, lineHeight: 1.35 }}>
          Reads your WHOOP recovery each morning and emails what to train today,
          how hard, and at what loads.
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 44, fontSize: 22, color: "#71717a" }}>
          <span>WHOOP API</span><span>·</span><span>Next.js</span><span>·</span>
          <span>Supabase</span><span>·</span><span>Claude</span>
        </div>
      </div>
    ),
    size,
  );
}
