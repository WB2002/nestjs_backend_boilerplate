import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(process.cwd());
const STRYKER_ALWAYS_IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.stryker-tmp',
  '.next',
  '.nuxt',
  '.svelte-kit',
]);

async function collectDirectorySymlinks(
  currentDir: string,
  rootDir: string,
): Promise<string[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks repository tree from process.cwd()
  const entries = await readdir(currentDir, { withFileTypes: true });
  const symlinkPaths: string[] = [];

  for (const entry of entries) {
    if (STRYKER_ALWAYS_IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path
      .relative(rootDir, absolutePath)
      .split(path.sep)
      .join('/');

    if (entry.isSymbolicLink()) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- checks symlink target within repository
      const targetStats = await stat(absolutePath).catch(() => null);
      if (targetStats?.isDirectory()) {
        symlinkPaths.push(relativePath);
      }
      continue;
    }

    if (entry.isDirectory()) {
      const nestedSymlinks = await collectDirectorySymlinks(
        absolutePath,
        rootDir,
      );
      symlinkPaths.push(...nestedSymlinks);
    }
  }

  return symlinkPaths;
}

function isIgnoredByStrykerPatterns(
  relativePath: string,
  ignorePatterns: readonly string[],
): boolean {
  const pathSegments = relativePath.split('/');

  return ignorePatterns.some((rawPattern) => {
    if (rawPattern.startsWith('!')) {
      return false;
    }

    let normalized = rawPattern;
    while (normalized.startsWith('/')) {
      normalized = normalized.slice(1);
    }
    if (normalized.endsWith('/**')) {
      normalized = normalized.slice(0, -3);
    } else if (normalized.endsWith('/*')) {
      normalized = normalized.slice(0, -2);
    }
    while (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    if (!normalized) {
      return false;
    }

    if (!normalized.includes('/')) {
      return pathSegments.includes(normalized);
    }

    return (
      relativePath === normalized || relativePath.startsWith(`${normalized}/`)
    );
  });
}

describe('stryker.config.mjs', () => {
  it('ignores every directory symlink in the repository so Stryker sandbox copyFile does not fail with EISDIR', async () => {
    const configUrl = pathToFileURL(
      path.join(REPO_ROOT, 'stryker.config.mjs'),
    ).href;
    const loadedModule = (await import(configUrl)) as {
      default: { ignorePatterns?: string[] };
    };
    const ignorePatterns = loadedModule.default.ignorePatterns ?? [];

    const directorySymlinks = await collectDirectorySymlinks(
      REPO_ROOT,
      REPO_ROOT,
    );

    expect(directorySymlinks.length).toBeGreaterThan(0);

    const unignoredSymlinks = directorySymlinks.filter(
      (symlinkPath) => !isIgnoredByStrykerPatterns(symlinkPath, ignorePatterns),
    );

    expect(unignoredSymlinks).toEqual([]);
  });
});
