export function buildSnippet(body: string, query: string, maxLength = 320): string {
  if (!body) return "";
  const normalizedBody = body.normalize("NFKC");
  const normalizedQuery = query.toLowerCase().normalize("NFKC");
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  let hitIndex = -1;
  for (const term of terms) {
    const idx = normalizedBody.toLowerCase().indexOf(term);
    if (idx !== -1) {
      hitIndex = idx;
      break;
    }
  }

  const start = hitIndex === -1 ? 0 : Math.max(0, hitIndex - Math.floor(maxLength / 4));
  const snippet = normalizedBody.slice(start, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLength < normalizedBody.length ? "…" : "";
  return `${prefix}${snippet}${suffix}`;
}
