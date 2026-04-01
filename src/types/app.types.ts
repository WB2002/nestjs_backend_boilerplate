import { IncomingMessage, ServerResponse } from 'http';

export interface IRequest extends IncomingMessage {
  user?: {
    id: string;
  };
}

export type IResponse = ServerResponse;
