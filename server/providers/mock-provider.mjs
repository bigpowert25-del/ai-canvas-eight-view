const WIDTH = 512;
const HEIGHT = 512;

const VIEW_POSES = [
  { id: "front", turn: 0, back: false },
  { id: "front-right", turn: 0.34, back: false },
  { id: "right", turn: 0.68, back: false },
  { id: "back-right", turn: 0.34, back: true },
  { id: "back", turn: 0, back: true },
  { id: "back-left", turn: -0.34, back: true },
  { id: "left", turn: -0.68, back: false },
  { id: "front-left", turn: -0.34, back: false },
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hash(input) {
  let value = 2166136261;
  for (const char of input) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function paletteFor(seed) {
  const value = hash(String(seed));
  const palettes = [
    { jacket: "#d86643", jacketDark: "#a7432d", skin: "#d99a72", hair: "#343b42", pants: "#293238", accent: "#ef9a76" },
    { jacket: "#3d7690", jacketDark: "#28556b", skin: "#c88964", hair: "#252d33", pants: "#28343c", accent: "#7ab1c8" },
    { jacket: "#6f7654", jacketDark: "#4c5238", skin: "#d3a07e", hair: "#393632", pants: "#303632", accent: "#a9ad82" },
  ];
  return palettes[value % palettes.length];
}

function characterMarkup(pose, palette, seed) {
  const bodyShift = pose.turn * 24;
  const faceScale = Math.max(0.32, 1 - Math.abs(pose.turn) * 0.68);
  const faceShift = pose.turn * 44;
  const farOpacity = 0.46 + (1 - Math.abs(pose.turn)) * 0.4;
  const badgeX = pose.turn >= 0 ? 190 : 296;
  const line = "#20272b";
  const tinyOffset = (seed % 9) - 4;

  return `
    <ellipse cx="256" cy="473" rx="128" ry="18" fill="#bcc4c5" opacity=".42"/>
    <g transform="translate(${bodyShift} 0)">
      <path d="M173 305c21-57 55-86 101-86s80 29 101 86l30 133H143Z" fill="${palette.jacket}" stroke="${line}" stroke-width="5"/>
      <path d="M274 222v214" stroke="${palette.jacketDark}" stroke-width="9"/>
      <path d="M180 321 112 430l48 23 79-111M368 321l68 109-48 23-79-111" fill="${palette.hair}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M208 435h58v49h-83Zm74 0h58l25 49h-83Z" fill="${palette.pants}" stroke="${line}" stroke-width="5"/>
      <rect x="178" y="475" width="99" height="17" rx="8" fill="${line}"/>
      <rect x="281" y="475" width="99" height="17" rx="8" fill="${line}"/>
      ${pose.back ? `
        <rect x="205" y="288" width="138" height="114" rx="26" fill="${palette.jacketDark}" stroke="${line}" stroke-width="5"/>
        <path d="M236 309v72M312 309v72" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round"/>
        <rect x="247" y="245" width="54" height="28" rx="12" fill="${palette.accent}"/>
      ` : `
        <rect x="${badgeX}" y="307" width="34" height="22" rx="7" fill="${palette.accent}" opacity=".96"/>
        <path d="M192 355h62M294 355h62" stroke="${palette.jacketDark}" stroke-width="7" stroke-linecap="round"/>
      `}
    </g>
    <g transform="translate(${faceShift + tinyOffset} 0) scale(${faceScale} 1)" transform-origin="256px 166px">
      <circle cx="256" cy="164" r="82" fill="${pose.back ? palette.hair : palette.skin}" stroke="${line}" stroke-width="5"/>
      <path d="M177 162c0-71 38-103 87-103 57 0 92 43 79 113-27-21-55-31-87-31-31 0-57 7-79 21Z" fill="${palette.hair}"/>
      ${pose.back ? `
        <path d="M190 153c18 48 40 76 66 86 34-15 56-47 69-96" fill="none" stroke="${palette.jacketDark}" stroke-width="12" stroke-linecap="round"/>
      ` : `
        <circle cx="227" cy="170" r="7" fill="${line}" opacity="${pose.turn > 0.48 ? farOpacity : 1}"/>
        <circle cx="285" cy="170" r="7" fill="${line}" opacity="${pose.turn < -0.48 ? farOpacity : 1}"/>
        <path d="M232 207c17 10 33 10 49 0" fill="none" stroke="#834b40" stroke-width="7" stroke-linecap="round"/>
      `}
      <path d="M177 120c-19 11-29 30-29 57v35h30v-75M335 120c19 11 29 30 29 57v35h-30v-75" fill="#657178" stroke="${line}" stroke-width="4"/>
      <circle cx="162" cy="194" r="15" fill="${palette.accent}"/>
      <circle cx="350" cy="194" r="15" fill="${palette.accent}"/>
    </g>
  `;
}

function sceneMarkup(pose, palette, seed) {
  const stripe = seed % 2 === 0 ? "#d7ddde" : "#dbe0df";
  return `
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#e8ebea"/>
    <path d="M0 104h512M0 400h512" stroke="${stripe}" stroke-width="2"/>
    <path d="M80 0v512M432 0v512" stroke="#e0e5e4" stroke-width="1"/>
    ${characterMarkup(pose, palette, seed)}
  `;
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export class MockImageProvider {
  id = "mock";

  async generateContactSheet({ prompt, seed = 24 }) {
    const palette = paletteFor(seed);
    const cells = VIEW_POSES.map((pose, index) => {
      const x = (index % 4) * WIDTH;
      const y = Math.floor(index / 4) * HEIGHT;
      return `<g transform="translate(${x} ${y})">${sceneMarkup(pose, palette, seed)}</g>`;
    }).join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024" viewBox="0 0 2048 1024">${cells}</svg>`;
    return {
      imageDataUrl: svgDataUrl(svg),
      provider: this.id,
      model: "mock-turntable-v1",
    };
  }

  async generateView({ prompt, viewId, seed = 24 }) {
    const pose = VIEW_POSES.find((item) => item.id === viewId) ?? VIEW_POSES[0];
    const palette = paletteFor(seed);
    const safeViewId = escapeXml(viewId);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512" data-view="${safeViewId}">${sceneMarkup(pose, palette, seed)}</svg>`;
    return {
      imageDataUrl: svgDataUrl(svg),
      provider: this.id,
      model: "mock-turntable-v1",
    };
  }
}

export const MOCK_VIEW_IDS = VIEW_POSES.map((item) => item.id);
