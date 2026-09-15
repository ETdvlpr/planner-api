import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: null;
}

/**
 * Wraps handler results in the same envelope hi-selam uses, so the React
 * clients can share one HTTP layer across both products.
 *
 * `BigInt` needs explicit handling: sync cursors are `bigint` and
 * `JSON.stringify` throws on them rather than coercing. They are serialised as
 * decimal strings, which is also what keeps a cursor past 2^53 honest.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<unknown> | StreamableFile
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<unknown> | StreamableFile> {
    return next.handle().pipe(
      map((data: T) => {
        if (data instanceof StreamableFile) return data;
        return {
          success: true,
          data: serialiseBigInts(data) ?? null,
          error: null,
        };
      }),
    );
  }
}

/** Recursively replaces `bigint` values with their decimal-string form. */
export function serialiseBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serialiseBigInts);

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = serialiseBigInts(entry);
  }
  return out;
}
