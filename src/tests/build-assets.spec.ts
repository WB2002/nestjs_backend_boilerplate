import { globSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

interface NestCliAssetEntry {
  include?: string;
}

interface NestCliConfig {
  sourceRoot?: string;
  compilerOptions?: {
    assets?: Array<string | NestCliAssetEntry>;
  };
}

const REPO_ROOT = join(__dirname, '..', '..');

function normalizeRelativePath(filePath: string): string {
  return filePath.split('\\').join(posix.sep);
}

describe('nest-cli.json build assets', () => {
  const nestCliPath = join(REPO_ROOT, 'nest-cli.json');
  const nestCli = JSON.parse(
    readFileSync(nestCliPath, 'utf8'),
  ) as NestCliConfig;
  const sourceRoot = join(REPO_ROOT, nestCli.sourceRoot ?? 'src');
  const assetPatterns = (nestCli.compilerOptions?.assets ?? []).map((entry) =>
    typeof entry === 'string' ? entry : (entry.include ?? ''),
  );

  it('matches at least one source file for every configured asset pattern', () => {
    expect(assetPatterns.length).toBeGreaterThan(0);

    for (const pattern of assetPatterns) {
      const matched = globSync(pattern, { cwd: sourceRoot });
      expect({ pattern, matchedCount: matched.length }).toEqual({
        pattern,
        matchedCount: expect.any(Number),
      });
      expect(matched.length).toBeGreaterThan(0);
    }
  });

  it('includes every .lua script under src/ so dist/ loads them at runtime', () => {
    const allLuaScripts = globSync('**/*.lua', { cwd: sourceRoot })
      .map(normalizeRelativePath)
      .sort();

    const matchedByAssets = new Set(
      assetPatterns.flatMap((pattern) =>
        globSync(pattern, { cwd: sourceRoot }).map(normalizeRelativePath),
      ),
    );

    const missingFromBuildAssets = allLuaScripts.filter(
      (scriptPath) => !matchedByAssets.has(scriptPath),
    );

    expect(missingFromBuildAssets).toEqual([]);
  });
});
