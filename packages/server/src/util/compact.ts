/**
 * Bridges zod's inferred types to the domain types' exact optional properties.
 *
 * `exactOptionalPropertyTypes` (on across this workspace) treats `foo?: string`
 * as "the key may be ABSENT" — explicitly assigning `undefined` is a different
 * thing and is rejected. Zod infers optional fields as `foo?: string | undefined`,
 * so a parsed request body cannot be handed straight to a domain constructor.
 *
 * Rather than casting at every boundary — which would silence genuine mistakes
 * along with this one — `compact` actually removes the undefined-valued keys at
 * runtime and describes that in the type. The strictness stays on everywhere
 * else; this is the single, deliberate place the two conventions meet.
 */

type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function compact<T extends object>(value: T): Compacted<T> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as Compacted<T>;
}
