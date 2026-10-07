import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { emptyContext, requestContext, type RequestContext } from './request-context';

/** Runs the handler inside the request's AsyncLocalStorage context (set up by the guards). */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ id: string; ctx?: RequestContext }>();
    const store = req.ctx ?? emptyContext(String(req.id));
    return new Observable((subscriber) =>
      requestContext.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
