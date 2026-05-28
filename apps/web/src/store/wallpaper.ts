import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WallpaperTheme = {
  id: string
  label: string
  colors: [string, string, string, string]
  /** Hex for the masked pattern overlay (the doodle ink colour). */
  ink: string
}

export type WallpaperPattern = {
  id: string
  label: string
  src: string
}

export const THEMES: WallpaperTheme[] = [
  {
    id: 'red',
    label: 'Crimson',
    colors: ['#FFD1D7', '#F58B97', '#D9434F', '#8C1421'],
    ink: '#5E0A10',
  },
  {
    id: 'blue',
    label: 'Ocean',
    colors: ['#D6E8FF', '#8FB8F0', '#3E7DD2', '#19305C'],
    ink: '#0D1F45',
  },
  {
    id: 'green',
    label: 'Forest',
    colors: ['#DBEEDC', '#9CCB9F', '#4E9C5F', '#1F4D2A'],
    ink: '#103820',
  },
  {
    id: 'purple',
    label: 'Amethyst',
    colors: ['#E6D6F5', '#B091D4', '#6B3FAA', '#2F1758'],
    ink: '#1F0E40',
  },
  {
    id: 'orange',
    label: 'Sunset',
    colors: ['#FFE2C2', '#FFAD6D', '#E36A2A', '#7A2F0A'],
    ink: '#4F1B05',
  },
  {
    id: 'mono',
    label: 'Mono',
    colors: ['#F2F2F2', '#C5C5C5', '#7A7A7A', '#2C2C2C'],
    ink: '#101010',
  },
]

export const PATTERNS: WallpaperPattern[] = [
  { id: 'late_night_delight', label: 'Doodles', src: '/patterns/late_night_delight.svg' },
  { id: 'animals', label: 'Animals', src: '/patterns/animals.svg' },
  { id: 'snowflakes', label: 'Snowflakes', src: '/patterns/snowflakes.svg' },
  { id: 'space', label: 'Space', src: '/patterns/space.svg' },
  { id: 'sweets', label: 'Sweets', src: '/patterns/sweets.svg' },
  { id: 'cats_and_dogs', label: 'Cats & Dogs', src: '/patterns/cats_and_dogs.svg' },
  { id: 'unicorn', label: 'Unicorn', src: '/patterns/unicorn.svg' },
  { id: 'paris', label: 'Paris', src: '/patterns/paris.svg' },
  { id: 'none', label: 'No pattern', src: '' },
]

type State = {
  themeId: string
  patternId: string
  setTheme: (id: string) => void
  setPattern: (id: string) => void
  reset: () => void
}

const DEFAULT_THEME = 'red'
const DEFAULT_PATTERN = 'late_night_delight'

export const useWallpaper = create<State>()(
  persist(
    (set) => ({
      themeId: DEFAULT_THEME,
      patternId: DEFAULT_PATTERN,
      setTheme: (id) => set({ themeId: id }),
      setPattern: (id) => set({ patternId: id }),
      reset: () => set({ themeId: DEFAULT_THEME, patternId: DEFAULT_PATTERN }),
    }),
    { name: 'cognigram-wallpaper' },
  ),
)

export function getTheme(id: string): WallpaperTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
export function getPattern(id: string): WallpaperPattern {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[0]
}
