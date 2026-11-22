/**
 * Single source of truth for brand palette constants used ONLY outside CSS DOM
 * (e.g., Next.js Viewport themeColor, standalone serialized print/SVG exports,
 * and Three.js WebGL materials where CSS custom properties cannot be resolved).
 *
 * Every React/JSX DOM element MUST use CSS custom properties from app/tokens.css.
 */
export const BRAND_THEME_COLOR = '#103c2e';

export const PRINT_THEMES = {
  parchment: {
    bg: '#f6f2e8',
    surface: '#fffdf9',
    surfaceSubtle: '#faf6ee',
    text: '#103c2e',
    muted: '#485c53',
    accent: '#c49635',
    accentDark: '#8c6a23',
    border: '#e2d9c8',
    brand: '#103c2e',
    brandSoft: '#e8f0ec',
  },
  dark: {
    bg: '#0b120f',
    surface: '#14201b',
    surfaceSubtle: '#101a16',
    text: '#f5efe2',
    muted: '#9db1a6',
    accent: '#dfb963',
    accentDark: '#b48a34',
    border: '#253930',
    brand: '#195c46',
    brandSoft: '#163529',
  },
  royal: {
    bg: '#0f1f38',
    surface: '#1a2e4c',
    surfaceSubtle: '#132440',
    text: '#f8fafc',
    muted: '#94a3b8',
    accent: '#e2b342',
    accentDark: '#c49635',
    border: '#2b4772',
    brand: '#103c2e',
    brandSoft: '#1a365d',
  },
} as const;

export const TREE_3D_COLORS = {
  fog: 0x0d211b,
  ambient: 0xf4ecd9,
  sun: 0xfff3d4,
  fill: 0x5c8f78,
  ground: 0x102920,
  nodeSelected: 0xdfb963,
  nodeDefault: 0x1a493a,
  nodeFemale: 0x265947,
  edgeParent: 0xc49635,
  edgeSpouse: 0xdfb963,
  edgeHistory: 0x8f7a52,
  labelText: '#f5efe2',
  labelBg: '#103c2e',
} as const;
