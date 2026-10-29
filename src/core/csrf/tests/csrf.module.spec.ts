import { CsrfModule } from '../csrf.module';
import { CsrfMiddleware } from '../middleware/csrf.middleware';
import { CsrfTokenService } from '../csrf-token.service';

describe('CsrfModule', () => {
  it('forRoot provides middleware and token service', () => {
    const dynamic = CsrfModule.forRoot({ enabled: true });
    const providers = dynamic.providers ?? [];
    const tokens = providers.map((p) =>
      typeof p === 'object' && p !== null && 'provide' in p
        ? (p as { provide: unknown }).provide
        : p,
    );
    expect(tokens).toContain(CsrfMiddleware);
    expect(tokens).toContain(CsrfTokenService);
  });
});
