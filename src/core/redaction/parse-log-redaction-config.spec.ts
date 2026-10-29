import { parseLogRedactionConfig } from './parse-log-redaction-config';

describe('parseLogRedactionConfig', () => {
  it('defaults to enabled', () => {
    expect(parseLogRedactionConfig({})).toEqual({ enabled: true });
  });

  it('disables when LOG_REDACTION_ENABLED=false', () => {
    expect(parseLogRedactionConfig({ LOG_REDACTION_ENABLED: 'false' })).toEqual(
      { enabled: false },
    );
  });
});
