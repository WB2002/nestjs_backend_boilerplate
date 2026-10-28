export interface JobHandler {
  handle(payload: unknown): Promise<void>;
}
