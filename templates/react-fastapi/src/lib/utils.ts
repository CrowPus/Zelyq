import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, letting a later Tailwind utility beat an earlier one.
 *
 * `cn("px-2", cond && "px-4")` gives `px-4` rather than both — which plain
 * string concatenation cannot do, because CSS order decides the winner and the
 * order of the class attribute does not.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
