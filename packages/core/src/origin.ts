/** Compare parsed network origins, never string prefixes or host suffix guesses. */
export function permitsUrl(value: string, origins: readonly string[], base?: string): boolean {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    return origins.some((origin) => {
      const allowed = new URL(origin);
      return !allowed.username && !allowed.password && url.origin === allowed.origin;
    });
  } catch { return false; }
}
