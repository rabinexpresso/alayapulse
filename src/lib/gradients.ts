/* ─────────────────────────────────────────────────────────────────────────
   Gradient slide themes — the custom slide's gradients, offered as themes on
   question slides, Heading / Bullets / Quote slides and the self-paced test
   and survey big screens. Each theme also has a plain colour (its colour
   maps keep a solid `bg`) for the places that need one, like the tint over a
   background image or a badge's text; the gradient is only the slide fill.
   Aurora is left out: it runs from light green to dark navy, so no single
   text colour reads well on all of it.
   ───────────────────────────────────────────────────────────────────────── */

export interface GradientTheme {
  id:    string
  label: string
  stops: [color: string, at: number][]
}

export const GRADIENT_THEMES: GradientTheme[] = [
  { id: 'midnight', label: 'Midnight', stops: [['#000079', 0], ['#1a0035', 100]] },
  { id: 'ocean',    label: 'Ocean',    stops: [['#000079', 0], ['#00b0ff', 100]] },
  { id: 'forest',   label: 'Forest',   stops: [['#000079', 0], ['#42db66', 100]] },
  { id: 'flame',    label: 'Flame',    stops: [['#ff0065', 0], ['#000079', 100]] },
  { id: 'sunset',   label: 'Sunset',   stops: [['#ff0065', 0], ['#ffc709', 100]] },
]

export const isGradientTheme = (id?: string) => GRADIENT_THEMES.some(g => g.id === id)

/** The gradient as CSS. `alpha` (two hex digits, e.g. 'cc') makes it see-through. */
export function gradientCss(id: string, alpha = ''): string {
  const g = GRADIENT_THEMES.find(x => x.id === id)
  if (!g) return ''
  return `linear-gradient(135deg, ${g.stops.map(([c, at]) => `${c}${alpha} ${at}%`).join(', ')})`
}

/** What to paint a slide with: the theme's gradient, or else its plain colour. */
export const themeFill = (id: string | undefined, solid: string, alpha = '') =>
  id && isGradientTheme(id) ? gradientCss(id, alpha) : `${solid}${solid.startsWith('#') ? alpha : ''}`
