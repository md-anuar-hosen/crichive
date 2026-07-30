const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guards a raw string against being handed straight to a `uuid` column — an
 * unparsable value there throws a raw Postgres error instead of a clean 404/400. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
