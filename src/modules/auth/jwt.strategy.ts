import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') ?? '',
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    orgId?: string;
  }): Promise<{ userId: string; email: string; role: string; orgId?: string }> {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      orgId: payload.orgId,
    };
  }
}
