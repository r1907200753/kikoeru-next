export function tagHref(tag: string): string {
  return `#/tag/${encodeURIComponent(tag)}`;
}

export function circleHref(name: string): string {
  return `#/circle/${encodeURIComponent(name)}`;
}

export function vaHref(name: string): string {
  return `#/va/${encodeURIComponent(name)}`;
}
