import { EventEmitter } from 'events';
import { get, IncomingHttpHeaders } from 'http';

export interface SseFrame {
  id?: string;
  event: string;
  data: Record<string, unknown>;
}

/** Streaming HTTP client with explicit socket cleanup and bounded waits. */
export async function openSse(
  url: string,
  headers: Record<string, string>,
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  frames: SseFrame[];
  waitFor: (predicate: (frames: SseFrame[]) => boolean) => Promise<void>;
  waitForClose: () => Promise<void>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers, agent: false });
    const headerTimeout = setTimeout(() => {
      request.destroy(new Error('SSE response headers timeout'));
    }, 5_000);
    request.once('error', reject);
    request.once('response', (response) => {
      clearTimeout(headerTimeout);
      const changed = new EventEmitter();
      const frames: SseFrame[] = [];
      let buffer = '';
      let ended = false;
      let closing = false;
      let failure: Error | undefined;
      const signal = () => changed.emit('change');
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const event = lines
            .find((line) => line.startsWith('event: '))
            ?.slice(7);
          const data = lines
            .find((line) => line.startsWith('data: '))
            ?.slice(6);
          if (event && data) {
            try {
              frames.push({
                event,
                id: lines.find((line) => line.startsWith('id: '))?.slice(4),
                data: JSON.parse(data) as Record<string, unknown>,
              });
            } catch (error) {
              failure = error as Error;
            }
          }
          signal();
        }
      });
      response.on('error', (error: Error) => {
        if (!ended && !closing) failure = error;
        signal();
      });
      response.on('close', () => {
        ended = true;
        signal();
      });
      const wait = (
        predicate: () => boolean,
        allowClosed: boolean,
      ): Promise<void> =>
        new Promise((done, fail) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            changed.off('change', check);
            if (error) fail(error);
            else done();
          };
          const check = () => {
            if (predicate()) finish();
            else if (failure) finish(failure);
            else if (ended && !allowClosed)
              finish(new Error('SSE closed before expected frames'));
          };
          const timeout = setTimeout(
            () => finish(new Error('SSE expected frames/close timeout')),
            5_000,
          );
          changed.on('change', check);
          check();
        });
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        frames,
        waitFor: (predicate) => wait(() => predicate(frames), false),
        waitForClose: () => wait(() => ended, true),
        close: async () => {
          closing = true;
          request.destroy();
          response.destroy();
          await wait(() => ended, true);
        },
      });
    });
    request.once('close', () => clearTimeout(headerTimeout));
  });
}
