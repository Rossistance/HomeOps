let counter = 0;

/** Generate a unique id for runtime-created entities. Seed data uses stable
 *  hand-written ids so cross-references survive a reseed. */
export function uid(prefix = "id"): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
