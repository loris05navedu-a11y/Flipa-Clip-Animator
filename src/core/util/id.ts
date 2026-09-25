/** Short, collision-resistant ids (not cryptographic). */
export function uid(prefix = ''): string {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return prefix + Date.now().toString(36) + rnd[0].toString(36) + rnd[1].toString(36).slice(0, 4);
}
