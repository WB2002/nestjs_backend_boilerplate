import type { ErrorObject } from 'ajv';

export function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
): string[] {
  if (!errors?.length) {
    return ['Validation failed'];
  }

  return errors.map((error) => {
    const path =
      error.instancePath.length > 0 ? error.instancePath.slice(1) : 'value';
    const detail = error.message ?? 'is invalid';
    return `${path} ${detail}`;
  });
}
