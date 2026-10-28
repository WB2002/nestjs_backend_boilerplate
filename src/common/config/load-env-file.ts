import { config } from 'dotenv';

config();

export function isWebSocketEnabled(): boolean {
  const raw = process.env.WEBSOCKET_ENABLED;
  if (raw === undefined || raw === '') {
    return true;
  }
  return raw === 'true' || raw === '1';
}
