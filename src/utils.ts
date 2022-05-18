export function as_nullable_string(thing: any): string | undefined {
  if (typeof thing === 'number') return String(thing)
  return typeof thing === 'string' ? thing : undefined;
}