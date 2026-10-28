import { buildSchema, parse, validate } from 'graphql';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GraphQL contract: categories query', () => {
  it('categories query validates against SDL', () => {
    const sdl = readFileSync(
      join(process.cwd(), 'src/categories/categories.graphql'),
      'utf8',
    );
    const schema = buildSchema(sdl);
    const document = parse('{ categories { id name description } }');
    expect(validate(schema, document)).toEqual([]);
  });
});
