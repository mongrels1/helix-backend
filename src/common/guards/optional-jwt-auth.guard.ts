import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard but never rejects: if a valid JWT is present, request.user is
 * populated; if absent or invalid, the request proceeds anonymously (request.user
 * is undefined). Used by endpoints that work for both signed-in and anonymous users
 * — e.g. saving a finished diagnostic (attach to the account only when logged in).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return (user || undefined) as TUser;
  }
}
