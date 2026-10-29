import { createBullMqDuplicateOptions } from '../create-bullmq-connection';

describe('createBullMqDuplicateOptions', () => {
  it('sets maxRetriesPerRequest null on duplicate options', () => {
    const dup = createBullMqDuplicateOptions();
    expect(dup.maxRetriesPerRequest).toBeNull();
  });
});
