import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

describe('GraphQL generated definitions', () => {
  const repoRoot = process.cwd();
  const graphqlDefinitionsPath = join(repoRoot, 'src/graphql.ts');
  const tsconfigPath = join(repoRoot, 'tsconfig.json');
  const appModulePath = join(repoRoot, 'src/app.module.ts');

  it('compiles src/graphql.ts without strict-mode TypeScript errors', () => {
    const configRead = ts.readConfigFile(tsconfigPath, (filePath) =>
      ts.sys.readFile(filePath),
    );
    expect(configRead.error).toBeUndefined();

    const parsedConfig = ts.parseJsonConfigFileContent(
      configRead.config,
      ts.sys,
      repoRoot,
    );
    const program = ts.createProgram(
      [graphqlDefinitionsPath],
      parsedConfig.options,
    );
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter(
        (diagnostic) => diagnostic.file?.fileName === graphqlDefinitionsPath,
      )
      .map(
        (diagnostic) =>
          `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
      );

    expect(diagnostics).toEqual([]);
  });

  it('configures GraphQLModule definitions with outputAs: interface so app startup does not regenerate strict-incompatible classes', () => {
    const appModuleSource = readFileSync(appModulePath, 'utf8');
    expect(appModuleSource).toMatch(/outputAs:\s*'interface'/);
  });
});
