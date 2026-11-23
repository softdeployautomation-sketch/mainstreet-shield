export function cn(
  ...inputs: Array<string | number | boolean | undefined | null | Record<string, boolean> | Array<unknown>>
): string {
  const classes: string[] = [];
  for (const input of inputs) {
    if (input == null) continue;
    if (typeof input === "string" || typeof input === "number") {
      classes.push(String(input));
    } else if (Array.isArray(input)) {
      classes.push(cn(...(input as Array<Parameters<typeof cn>[0][]>)));
    } else if (typeof input === "object") {
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (value) classes.push(key);
      }
    }
  }
  return classes.join(" ");
}
