import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes intelligently — later classes override earlier
 * conflicting ones (e.g. `cn("p-2", "p-4")` → `"p-4"`).
 * Used throughout shadcn/ui components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
