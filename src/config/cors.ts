/**
 * Origin matching for CORS.
 *
 * `CORS_ORIGIN` is a comma-separated list. An entry is either an exact origin
 * (`https://memory.dave.com.et`) or a pattern with `*` standing for one DNS
 * label or more (`https://planner-web-*.vercel.app`). Patterns exist for
 * Vercel preview deployments, whose hostnames are minted per branch and
 * cannot be listed in advance.
 *
 * `*` never crosses a `/` or a `:`, so a pattern can only ever widen the
 * host part, and only within the scheme and suffix written next to it.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function originMatcher(
  allowed: string[],
): (origin: string | undefined) => boolean {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];

  for (const entry of allowed) {
    if (!entry.includes('*')) {
      exact.add(entry);
      continue;
    }
    const source = entry
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/:]+');
    patterns.push(new RegExp(`^${source}$`));
  }

  return (origin) => {
    // No Origin header means a same-origin or non-browser request; the CORS
    // layer has nothing to decide and Express passes it through.
    if (!origin) return true;
    if (exact.has(origin)) return true;
    return patterns.some((pattern) => pattern.test(origin));
  };
}
