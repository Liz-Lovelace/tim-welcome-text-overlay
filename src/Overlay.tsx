import React from "react";
import { AbsoluteFill, staticFile, continueRender, delayRender } from "remotion";

export type OverlayProps = {
  upperText: string;
  lowerText: string;
};

export const defaultOverlayProps: OverlayProps = {
  upperText: "Kaindy lake Almaty",
  lowerText:
    "a quiet signal drifts through the city at night, soft lights flicker and people move without knowing why",
};

// Figma's `leading-trim: both; text-edge: cap` places the block top a few px
// above the actual cap ink. Chromium's `text-box-edge: cap` clamps tighter,
// rendering the text slightly too high. Measured offset: bold 60px needs to
// drop ~3.4px at 1x to match the Figma output pixel-for-pixel.
const UPPER_Y_FIX = 3.4;

// Upper text truncates with an ellipsis past this character count — matches
// the design's single-line intent so long titles don't collide with the body.
const UPPER_MAX_CHARS = 43;
const clampUpper = (s: string) =>
  s.length > UPPER_MAX_CHARS ? s.slice(0, UPPER_MAX_CHARS) + "..." : s;

const UPPER = {
  x: 57,
  y: 850,
  width: 1281,
  fontSize: 60,
  fontFamily: "InterOverlayBold",
  fontWeight: 700 as const,
};
const LOWER = {
  x: 57,
  y: 920,
  width: 1218,
  fontSize: 36,
  fontFamily: "InterOverlayMedium",
  fontWeight: 500 as const,
};

// 4 stacked semi-transparent strokes → approximated as 4 layered zero-offset
// text-shadows. Same blur each; stacking alpha builds a denser halo near the
// glyph, matching the Figma "Stroke" effect used 4× in the source design.
const haloShadow = (radiusPx: number) => {
  const layer = `0 0 ${radiusPx}px rgba(0, 0, 0, 0.25)`;
  return [layer, layer, layer, layer].join(", ");
};

// Modern text-box-trim API (Chromium ≥133) aligns block edges to glyph
// cap-top / alphabetic-baseline — matches Figma's `leading-trim: both`.
const trimToCap: React.CSSProperties = {
  // @ts-expect-error — not yet in React's CSS typings
  textBoxTrim: "trim-both",
  textBoxEdge: "cap alphabetic",
};

const useFonts = () => {
  const [handle] = React.useState(() => delayRender("loading-fonts"));
  React.useEffect(() => {
    const bold = new FontFace(
      "InterOverlayBold",
      `url(${staticFile("fonts/Inter-Bold.otf")}) format("opentype")`,
      { weight: "700", style: "normal" }
    );
    const medium = new FontFace(
      "InterOverlayMedium",
      `url(${staticFile("fonts/Inter-Medium.otf")}) format("opentype")`,
      { weight: "500", style: "normal" }
    );
    Promise.all([bold.load(), medium.load()]).then((faces) => {
      faces.forEach((f) => document.fonts.add(f));
      continueRender(handle);
    });
  }, [handle]);
};

export const Overlay: React.FC<OverlayProps> = ({ upperText, lowerText }) => {
  useFonts();

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          position: "absolute",
          left: UPPER.x,
          top: UPPER.y + UPPER_Y_FIX,
          width: UPPER.width,
          color: "#FFF",
          fontFamily: UPPER.fontFamily,
          fontSize: UPPER.fontSize,
          fontWeight: UPPER.fontWeight,
          fontStyle: "normal",
          lineHeight: 1.2,
          textAlign: "left",
          textShadow: haloShadow(5),
          ...trimToCap,
        }}
      >
        {clampUpper(upperText)}
      </div>

      <div
        style={{
          position: "absolute",
          left: LOWER.x,
          top: LOWER.y,
          width: LOWER.width,
          color: "#FFF",
          fontFamily: LOWER.fontFamily,
          fontSize: LOWER.fontSize,
          fontWeight: LOWER.fontWeight,
          fontStyle: "normal",
          lineHeight: 1.2,
          textAlign: "left",
          textShadow: haloShadow(3),
          ...trimToCap,
        }}
      >
        {lowerText}
      </div>
    </AbsoluteFill>
  );
};
