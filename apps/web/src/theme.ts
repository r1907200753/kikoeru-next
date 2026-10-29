export type Theme = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

export type Palette = 'teal' | 'pink' | 'blue' | 'violet' | 'matcha' | 'amber';

export interface PaletteOption {
  key: Palette;
  label: string;
  description: string;
  swatch: string;
}

export const PALETTE_OPTIONS: PaletteOption[] = [
  { key: 'teal', label: '青岚', description: '默认', swatch: '#0f6b7d' },
  { key: 'pink', label: '樱花粉', description: '柔和', swatch: '#b84774' },
  { key: 'blue', label: '雾蓝', description: '冷静', swatch: '#356fa8' },
  { key: 'violet', label: '紫藤', description: '梦幻', swatch: '#7a56a8' },
  { key: 'matcha', label: '抹茶', description: '清透', swatch: '#4f7a4c' },
  { key: 'amber', label: '琥珀', description: '温暖', swatch: '#a96f1f' },
];

const THEME_KEY = 'kikoeru.theme';
const PALETTE_KEY = 'kikoeru.palette';

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // 隐私模式下 localStorage 不可用，跟随系统。
  }
  return 'system';
}

export function readPalette(): Palette {
  try {
    const stored = localStorage.getItem(PALETTE_KEY);
    if (PALETTE_OPTIONS.some((option) => option.key === stored)) {
      return stored as Palette;
    }
  } catch {
    // 隐私模式下无法读取，使用默认主题色。
  }
  return 'teal';
}

export function applyPalette(palette: Palette): void {
  document.documentElement.dataset.palette = palette;
  try {
    localStorage.setItem(PALETTE_KEY, palette);
  } catch {
    // 无法持久化时仅本次会话生效。
  }
}

export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolved === 'dark' ? '#0c1416' : '#f2f6f7';
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 无法持久化时仅本次会话生效。
  }
  return resolved;
}
