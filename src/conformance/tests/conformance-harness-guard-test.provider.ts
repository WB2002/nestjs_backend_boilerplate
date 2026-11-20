import { TestingModuleBuilder } from '@nestjs/testing';
import { ConformanceHarnessAuthGuard } from '../guards/conformance-harness-auth.guard';

/** Stub harness auth in controller specs that focus on handler behavior, not guard logic. */
export function withConformanceHarnessGuardStub(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideGuard(ConformanceHarnessAuthGuard)
    .useValue({ canActivate: () => true });
}
