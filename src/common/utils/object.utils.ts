/**
 * Builds an object that omits keys whose values are `undefined`.
 * Required under `exactOptionalPropertyTypes` — prefer omitting keys over
 * widening optional properties to `T | undefined`.
 */
export function withoutUndefined<T extends object>(
  input: T,
): {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
} {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  // Runtime omits undefined keys; cast bridges exactOptionalPropertyTypes.
  return result as never;
}
