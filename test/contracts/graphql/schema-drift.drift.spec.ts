import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GraphQL SDL snapshot', () => {
  it('matches committed schema.snapshot.graphql', () => {
    const current = execSync('./scripts/ci/merge-graphql-sdl.sh', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const expected = readFileSync(
      join(__dirname, 'schema.snapshot.graphql'),
      'utf8',
    );
    expect(current).toBe(expected);
  });
});
