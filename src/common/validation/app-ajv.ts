import Ajv from 'ajv';
import type { Options } from 'ajv';
import addFormats from 'ajv-formats';

/** Strict AJV for route/query validation: unknown fields fail when `additionalProperties` is false. */
const AJV_OPTIONS: Options = {
  removeAdditional: false,
  coerceTypes: true,
  useDefaults: true,
  allErrors: true,
};

let appAjv: Ajv | undefined;

export function getAppAjv(): Ajv {
  if (!appAjv) {
    appAjv = new Ajv(AJV_OPTIONS);
    addFormats(appAjv);
  }
  return appAjv;
}

/** @internal Test hook to reset the process-wide AJV singleton. */
export function resetAppAjvForTests(): void {
  appAjv = undefined;
}
