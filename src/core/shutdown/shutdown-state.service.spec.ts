import { ShutdownState } from './shutdown-state.service';

describe('ShutdownState', () => {
  it('starts not shutting down', () => {
    const state = new ShutdownState();
    expect(state.isShuttingDown).toBe(false);
  });

  it('beginShutdown flips isShuttingDown to true', () => {
    const state = new ShutdownState();
    state.beginShutdown();
    expect(state.isShuttingDown).toBe(true);
  });

  it('beginShutdown is idempotent', () => {
    const state = new ShutdownState();
    state.beginShutdown();
    state.beginShutdown();
    expect(state.isShuttingDown).toBe(true);
  });
});
