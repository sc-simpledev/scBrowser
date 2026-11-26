/** How reader view sets its text, kept between pages and changed from the address bar. */
export interface ReaderStyle {
  font: 'sans' | 'serif'
  size: 'small' | 'medium' | 'large' | 'larger'
  width: 'narrow' | 'medium' | 'wide'
  theme: 'auto' | 'light' | 'sepia' | 'dark'
}

export const DEFAULT_READER_STYLE: ReaderStyle = { font: 'sans', size: 'medium', width: 'medium', theme: 'auto' }

export const READER_CHOICES = {
  font: [
    { id: 'sans', label: 'Sans serif' },
    { id: 'serif', label: 'Serif' }
  ],
  size: [
    { id: 'small', label: 'Small' },
    { id: 'medium', label: 'Medium' },
    { id: 'large', label: 'Large' },
    { id: 'larger', label: 'Larger' }
  ],
  width: [
    { id: 'narrow', label: 'Narrow' },
    { id: 'medium', label: 'Medium' },
    { id: 'wide', label: 'Wide' }
  ],
  theme: [
    { id: 'auto', label: 'Match scTerra' },
    { id: 'light', label: 'Light' },
    { id: 'sepia', label: 'Sepia' },
    { id: 'dark', label: 'Dark' }
  ]
} as const satisfies { [K in keyof ReaderStyle]: readonly { id: ReaderStyle[K]; label: string }[] }

export const isReaderStyle = (value: unknown): value is ReaderStyle => {
  const style = value as Record<string, unknown> | null
  return (
    typeof style === 'object' &&
    style !== null &&
    Object.keys(style).length === 4 &&
    (Object.keys(READER_CHOICES) as (keyof ReaderStyle)[]).every((key) => (READER_CHOICES[key] as readonly { id: string }[]).some((option) => option.id === style[key]))
  )
}
