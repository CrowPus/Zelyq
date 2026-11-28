/**
 * Small flags for the language lists, drawn here as SVG so they look the same
 * on every system: Windows shows emoji flags as two letters ("ES"). The same
 * file is used by Zelyq, Zelyq Accounts and the website.
 *
 * A flag stands for the language as Zelyq writes it: English is the UK's,
 * Portuguese is Brazil's (pt-BR), Chinese is China's (Simplified).
 */

/** Which flag a language or locale tag shows; null for one without a fitting flag (Arabic, Swahili). */
export function flagFor(tag: string): string | null {
  const lower = tag.toLowerCase().replace("_", "-");
  const exact: Record<string, string> = {
    "en-us": "us",
    "en-gb": "gb",
    "pt-pt": "pt",
    "pt-br": "br",
  };
  if (exact[lower]) return exact[lower];
  const byLanguage: Record<string, string> = {
    en: "gb",
    fr: "fr",
    de: "de",
    es: "es",
    pt: "br",
    zh: "cn",
    it: "it",
    nl: "nl",
    ja: "jp",
  };
  return byLanguage[lower.split("-")[0] ?? ""] ?? null;
}

/** A five-pointed star's points, centre (x, y), outer radius r, one point towards angle `turn` (degrees, 0 = up). */
function star(x: number, y: number, r: number, turn = 0): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.382;
    const angle = ((turn + i * 36 - 90) * Math.PI) / 180;
    points.push(
      `${(x + radius * Math.cos(angle)).toFixed(2)},${(y + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return points.join(" ");
}

const stripes = (colours: string[], vertical: boolean) =>
  colours
    .map((fill, i) => {
      const step = (vertical ? 20 : 15) / colours.length;
      return vertical
        ? `<rect x="${(i * step).toFixed(3)}" y="0" width="${step.toFixed(3)}" height="15" fill="${fill}"/>`
        : `<rect x="0" y="${(i * step).toFixed(3)}" width="20" height="${step.toFixed(3)}" fill="${fill}"/>`;
    })
    .join("");

/** The flag's drawing inside a 20 × 15 box; `id` keeps clip paths apart when one flag shows twice on a page. */
function drawing(country: string, id: string): string | null {
  switch (country) {
    case "fr":
      return stripes(["#002654", "#ffffff", "#ce1126"], true);
    case "it":
      return stripes(["#009246", "#ffffff", "#ce2b37"], true);
    case "de":
      return stripes(["#000000", "#dd0000", "#ffce00"], false);
    case "nl":
      return stripes(["#ae1c28", "#ffffff", "#21468b"], false);
    case "es":
      return '<rect width="20" height="15" fill="#aa151b"/><rect y="3.75" width="20" height="7.5" fill="#f1bf00"/>';
    case "pt":
      return (
        '<rect width="20" height="15" fill="#ff0000"/><rect width="8" height="15" fill="#006600"/>' +
        '<circle cx="8" cy="7.5" r="2.7" fill="#ffcc00"/><rect x="6.9" y="6.1" width="2.2" height="2.7" rx=".4" fill="#ffffff" stroke="#ff0000" stroke-width=".45"/>'
      );
    case "br":
      return (
        '<rect width="20" height="15" fill="#009c3b"/><polygon points="1.8,7.5 10,1.6 18.2,7.5 10,13.4" fill="#ffdf00"/>' +
        '<circle cx="10" cy="7.5" r="3.5" fill="#002776"/>' +
        `<clipPath id="br${id}"><circle cx="10" cy="7.5" r="3.5"/></clipPath>` +
        `<path d="M5.8 6.6 Q10 5.3 14.4 8.4" stroke="#ffffff" stroke-width=".6" fill="none" clip-path="url(#br${id})"/>`
      );
    case "cn":
      return (
        '<rect width="20" height="15" fill="#ee1c25"/>' +
        `<polygon points="${star(3.75, 3.75, 2.25)}" fill="#ffff00"/>` +
        [
          [7.5, 1.5, 28],
          [9, 3, 5],
          [9, 5.25, -15],
          [7.5, 6.75, -38],
        ]
          .map(([x, y, turn]) => `<polygon points="${star(x!, y!, 0.75, turn)}" fill="#ffff00"/>`)
          .join("")
      );
    case "jp":
      return '<rect width="20" height="15" fill="#ffffff"/><circle cx="10" cy="7.5" r="4.5" fill="#bc002d"/>';
    case "us": {
      const band = 15 / 13;
      let out = '<rect width="20" height="15" fill="#ffffff"/>';
      for (let i = 0; i < 13; i += 2)
        out += `<rect y="${(i * band).toFixed(3)}" width="20" height="${band.toFixed(3)}" fill="#b22234"/>`;
      out += `<rect width="8" height="${(band * 7).toFixed(3)}" fill="#3c3b6e"/>`;
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 5; col++)
          out += `<circle cx="${(0.9 + col * 1.55).toFixed(2)}" cy="${(0.95 + row * 1.85).toFixed(2)}" r=".38" fill="#ffffff"/>`;
      return out;
    }
    case "gb":
      // The Union Flag, drawn on its own 60 × 30 grid and cut to the box.
      return (
        `<svg x="0" y="0" width="20" height="15" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">` +
        `<clipPath id="gbs${id}"><path d="M0,0 v30 h60 v-30 z"/></clipPath>` +
        `<clipPath id="gbt${id}"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>` +
        `<g clip-path="url(#gbs${id})"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/>` +
        '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" stroke-width="6"/>' +
        `<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#gbt${id})" stroke="#c8102e" stroke-width="4"/>` +
        '<path d="M30,0 v30 M0,15 h60" stroke="#ffffff" stroke-width="10"/>' +
        '<path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6"/></g></svg>'
      );
    default:
      return null;
  }
}

/**
 * The flag as an SVG string, or null when the language has none. Decorative:
 * the language's name always stands beside it, so it is hidden from screen readers.
 */
export function flagSvg(tag: string, id = "", className = "flag"): string | null {
  const country = flagFor(tag);
  const inner = country ? drawing(country, id.replace(/[^A-Za-z0-9_-]/g, "")) : null;
  if (!inner) return null;
  return `<svg class="${className}" viewBox="0 0 20 15" width="20" height="15" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/**
 * A globe for "Language" that slowly turns: three meridians sweep across it
 * like a real globe's. Drawn in the text colour. The turning is the `.globe`
 * rules in the stylesheet (GLOBE_CSS), which stop for reduced motion.
 */
export function globeSvg(className = "globe", size = 18): string {
  const meridians = [1, 2, 3]
    // The line keeps its width while the meridian narrows.
    .map(
      (n) =>
        `<ellipse class="m m${n}" cx="12" cy="12" rx="9.2" ry="9.2" vector-effect="non-scaling-stroke" stroke-width="${((1.6 * size) / 24).toFixed(2)}"/>`,
    )
    .join("");
  return (
    `<svg class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false">` +
    '<circle cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".08"/>' +
    '<path d="M2.8 12h18.4M4.4 7.2c4.6 1.6 10.6 1.6 15.2 0M4.4 16.8c4.6-1.6 10.6-1.6 15.2 0" stroke-opacity=".7"/>' +
    `<g stroke-opacity=".9">${meridians}</g>` +
    '<circle cx="12" cy="12" r="9.2"/></svg>'
  );
}

/** The globe's turning, for the stylesheet. */
export const GLOBE_CSS = `
.globe .m { transform-box: view-box; transform-origin: 12px 12px; animation: globe-turn 7s linear infinite; }
.globe .m2 { animation-delay: -2.333s; }
.globe .m3 { animation-delay: -4.667s; }
@keyframes globe-turn {
  0% { transform: scaleX(1); animation-timing-function: cubic-bezier(.37, 0, .63, 1); }
  50% { transform: scaleX(-1); animation-timing-function: cubic-bezier(.37, 0, .63, 1); }
  100% { transform: scaleX(1); }
}
@media (prefers-reduced-motion: reduce) {
  .globe .m { animation: none; }
  .globe .m1 { transform: scaleX(.5); }
  .globe .m2 { transform: scaleX(0); }
  .globe .m3 { display: none; }
}
`;
