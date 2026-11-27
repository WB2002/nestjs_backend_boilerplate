import type { JSONSchemaType } from 'ajv';

/** Optional query metadata validated before multipart streaming begins. */
export type UploadQuery = {
  clientRequestId?: string;
};

export const uploadQuerySchema: JSONSchemaType<UploadQuery> = {
  type: 'object',
  properties: {
    clientRequestId: { type: 'string', maxLength: 128, nullable: true },
  },
  required: [],
  additionalProperties: false,
};
