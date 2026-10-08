import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { loginRequestSchema, refreshRequestSchema, type AuthTokens, type LoginResponse, type Me } from '@hms/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Ctx, Public } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AuthService } from './auth.service';

export const REFRESH_COOKIE = 'hms_rt';
const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: z.output<typeof loginRequestSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const { refreshToken, ...rest } = await this.auth.login(body, req.ip);
    if (body.client === 'web') {
      this.setCookie(reply, refreshToken);
      return rest;
    }
    return { ...rest, refreshToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodPipe(refreshRequestSchema)) body: z.output<typeof refreshRequestSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthTokens> {
    const raw = body.refreshToken ?? req.cookies[REFRESH_COOKIE];
    try {
      const { refreshToken, ...rest } = await this.auth.refresh(raw ?? '', body.client, req.ip);
      if (body.client === 'web') {
        this.setCookie(reply, refreshToken);
        return rest;
      }
      return { ...rest, refreshToken };
    } catch (e) {
      if (body.client === 'web') reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(body?.refreshToken ?? req.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  me(@Ctx() ctx: RequestContext): Promise<Me> {
    return this.auth.me(ctx.tenantId!, ctx.userId!);
  }

  private setCookie(reply: FastifyReply, token: string) {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      // Secure only when the browser is on HTTPS (behind the proxy), so a plain http://host:port deploy still keeps the session.
      secure: this.config.NODE_ENV === 'production' && reply.request.protocol === 'https',
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: this.config.JWT_REFRESH_TTL_DAYS * 24 * 3600,
    });
  }
}
