/* eslint-disable security/detect-non-literal-fs-filename -- unit test operates exclusively on ephemeral mkdtempSync paths under os.tmpdir() */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT_DIR = resolve(__dirname, '../../..');
const SOURCE_AUDIT_SCRIPT_PATH = join(
  REPO_ROOT_DIR,
  'scripts/ci/run-conformance-audit.sh',
);

async function allocateFreeTcpPort(): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const probeServer = createServer();
    probeServer.once('error', rejectPort);
    probeServer.listen(0, '127.0.0.1', () => {
      const address = probeServer.address();
      if (address === null || typeof address === 'string') {
        probeServer.close();
        rejectPort(new Error('Failed to allocate ephemeral TCP port'));
        return;
      }
      const allocatedPort = address.port;
      probeServer.close((closeError) => {
        if (closeError) {
          rejectPort(closeError);
          return;
        }
        resolvePort(allocatedPort);
      });
    });
  });
}

function createMockSandbox(hasPidFlagSupport: boolean): {
  sandboxDir: string;
  scriptPath: string;
  mockAuditBinPath: string;
  capturedArgsFilePath: string;
} {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'conformance-audit-script-'));
  const scriptDir = join(sandboxDir, 'scripts/ci');
  const distDir = join(sandboxDir, 'dist');
  const binDir = join(sandboxDir, 'bin');

  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptDir, 'run-conformance-audit.sh');
  copyFileSync(SOURCE_AUDIT_SCRIPT_PATH, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeFileSync(join(sandboxDir, 'boilerplate.manifest.json'), '{}', 'utf8');

  const stubAppScript = [
    'const http = require("node:http");',
    'const port = Number(process.env.PORT || 3000);',
    'const server = http.createServer((req, res) => {',
    '  if (req.url === "/health/live") {',
    '    res.writeHead(200, { "content-type": "application/json" });',
    '    res.end(JSON.stringify({ status: "ok" }));',
    '    return;',
    '  }',
    '  res.writeHead(404);',
    '  res.end();',
    '});',
    'server.listen(port, "127.0.0.1");',
    'process.on("SIGTERM", () => { server.close(() => process.exit(0)); });',
  ].join('\n');
  writeFileSync(join(distDir, 'main.js'), stubAppScript, 'utf8');

  const capturedArgsFilePath = join(sandboxDir, 'captured-args.txt');
  const pidHelpLine = hasPidFlagSupport
    ? '  -pid int\\n    \\tOptional host process PID to sample for memory leak detection\\n'
    : '';
  const rejectPidBlock = hasPidFlagSupport
    ? ''
    : [
        'for arg in "$@"; do',
        '  if [[ "${arg}" == "--pid" || "${arg}" == "-pid" || "${arg}" == --pid=* || "${arg}" == -pid=* ]]; then',
        '    echo "flag provided but not defined: -pid" >&2',
        '    exit 2',
        '  fi',
        'done',
      ].join('\n');

  const mockAuditBinScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then',
    `  printf 'Usage of conformance-audit:\\n  -manifest string\\n  -output string\\n${pidHelpLine}  -profile string\\n  -stages string\\n  -target string\\n  -url string\\n' >&2`,
    '  exit 2',
    'fi',
    rejectPidBlock,
    `printf '%s\\n' "$@" > "${capturedArgsFilePath}"`,
  ].join('\n');

  const mockAuditBinPath = join(binDir, 'conformance-audit');
  writeFileSync(mockAuditBinPath, mockAuditBinScript, 'utf8');
  chmodSync(mockAuditBinPath, 0o755);

  return {
    sandboxDir,
    scriptPath,
    mockAuditBinPath,
    capturedArgsFilePath,
  };
}

describe('scripts/ci/run-conformance-audit.sh', () => {
  it('omits --pid when conformance-audit binary does not support -pid', async () => {
    const sandbox = createMockSandbox(false);
    const allocatedPort = await allocateFreeTcpPort();
    try {
      const execution = spawnSync(
        sandbox.scriptPath,
        [
          '--stages',
          'sast,graph,pentest,load',
          '--profile',
          'baseline',
          '--output',
          'reports',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            CONFORMANCE_AUDIT_BIN: sandbox.mockAuditBinPath,
            SKIP_APP_BUILD: 'true',
            PORT: String(allocatedPort),
            GEOIP_DATABASE_PATH: join(sandbox.sandboxDir, 'stub.mmdb'),
            JWT_PRIVATE_KEY: 'stub-private-key',
            JWT_PUBLIC_KEY: 'stub-public-key',
          },
        },
      );

      expect(execution.status).toBe(0);
      expect(execution.stderr).not.toContain(
        'flag provided but not defined: -pid',
      );
      const receivedArgs = readFileSync(sandbox.capturedArgsFilePath, 'utf8')
        .trim()
        .split('\n');
      expect(receivedArgs).not.toContain('--pid');
      expect(receivedArgs).toContain(`http://127.0.0.1:${allocatedPort}`);
    } finally {
      rmSync(sandbox.sandboxDir, { recursive: true, force: true });
    }
  });

  it('passes --pid when conformance-audit binary advertises -pid support', async () => {
    const sandbox = createMockSandbox(true);
    const allocatedPort = await allocateFreeTcpPort();
    try {
      const execution = spawnSync(
        sandbox.scriptPath,
        [
          '--stages',
          'sast,graph,pentest,load',
          '--profile',
          'baseline',
          '--output',
          'reports',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            CONFORMANCE_AUDIT_BIN: sandbox.mockAuditBinPath,
            SKIP_APP_BUILD: 'true',
            PORT: String(allocatedPort),
            GEOIP_DATABASE_PATH: join(sandbox.sandboxDir, 'stub.mmdb'),
            JWT_PRIVATE_KEY: 'stub-private-key',
            JWT_PUBLIC_KEY: 'stub-public-key',
          },
        },
      );

      expect(execution.status).toBe(0);
      const receivedArgs = readFileSync(sandbox.capturedArgsFilePath, 'utf8')
        .trim()
        .split('\n');
      const pidFlagIndex = receivedArgs.indexOf('--pid');
      expect(pidFlagIndex).toBeGreaterThan(-1);
      expect(receivedArgs[pidFlagIndex + 1]).toMatch(/^\d+$/);
    } finally {
      rmSync(sandbox.sandboxDir, { recursive: true, force: true });
    }
  });
});
