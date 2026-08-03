// lib/utils.ts
// One tiny helper used everywhere: cn() merges Tailwind class strings.
//
// Why it exists: when a component takes a className prop AND has its own
// default classes, naive string concatenation can produce conflicts like
// "p-2 p-4" where the winner is unpredictable. tailwind-merge resolves
// those conflicts (last one wins), and clsx lets us pass conditionals
// like cn("base", isActive && "bg-accent").
// This is the same helper shadcn/ui components are built around.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
