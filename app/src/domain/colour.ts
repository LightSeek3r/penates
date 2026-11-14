/** WCAG relative luminance of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

export type Lab = readonly [number, number, number]

const linearRgb = (hex: string): Lab => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return [r, g, b]
}

/** Full dichromacy (severity 1) from Machado, Oliveira and Fernandes (2009), applied to linear RGB. */
export const DICHROMACY = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const satisfies Record<string, readonly Lab[]>

export type Dichromacy = keyof typeof DICHROMACY

/** OKLab (Björn Ottosson) of a `#RRGGBB` colour, as seen with the given dichromacy or with normal vision. */
export function oklab(hex: string, vision?: Dichromacy): Lab {
  const rgb = linearRgb(hex)
  const [r, g, b] = vision ? DICHROMACY[vision].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) : rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** Euclidean distance in OKLab; about 0.02 is the just-noticeable difference. */
export function oklabDistance(a: string, b: string, vision?: Dichromacy): number {
  const [l1, a1, b1] = oklab(a, vision)
  const [l2, a2, b2] = oklab(b, vision)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}
