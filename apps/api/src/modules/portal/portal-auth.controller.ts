import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { portal } from '@hms/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Public } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { PortalAuthService } from './portal-auth.service';

export const PATIENT_REFRESH_COOKIE = 'hms_prt';
const COOKIE_PATH = '/api/v1/portal/auth';
const hospitalQuery = z.object({ code: z.string().trim().toLowerCase().min(2).max(63) });

/** Patient sign-in with mobile + OTP. All routes are public; tokens are typ 'patient'. */
@Public()
@Controller('portal')
export class PortalAuthController {
  constructor(
    private readonly auth: PortalAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('hospital')
  hospital(@Query(new ZodPipe(hospitalQuery)) q: z.output<typeof hospitalQuery>): Promise<portal.PortalHospital> {
    return this.auth.hospital(q.code);
  }

  @Post('auth/otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodPipe(portal.otpRequestSchema)) body: z.output<typeof portal.otpRequestSchema>, @Req() req: FastifyRequest) {
    return this.auth.requestOtp(body, req.ip);
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodPipe(portal.otpVerifySchema)) body: z.output<typeof portal.otpVerifySchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<portal.PatientLoginResponse> {
    const { refreshToken, ...rest } = await this.auth.verifyOtp(body, req.ip);
    if (body.client === 'web') {
      this.setCookie(reply, refreshToken);
      return rest;
    }
    return { ...rest, refreshToken };
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodPipe(portal.patientRefreshSchema)) body: z.output<typeof portal.patientRefreshSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<portal.PatientTokens> {
    const raw = body.refreshToken ?? req.cookies[PATIENT_REFRESH_COOKIE];
    try {
      const { refreshToken, ...rest } = await this.auth.refresh(raw ?? '', req.ip);
      if (body.client === 'web') {
        this.setCookie(reply, refreshToken);
        return rest;
      }
      return { ...rest, refreshToken };
    } catch (e) {
      if (body.client === 'web') reply.clearCookie(PATIENT_REFRESH_COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(body?.refreshToken ?? req.cookies[PATIENT_REFRESH_COOKIE]);
    reply.clearCookie(PATIENT_REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  private setCookie(reply: FastifyReply, token: string) {
    reply.setCookie(PATIENT_REFRESH_COOKIE, token, {
      httpOnly: true,
      // Secure only when the browser is on HTTPS (behind the proxy), so a plain http://host:port deploy still keeps the session.
      secure: this.config.NODE_ENV === 'production' && reply.request.protocol === 'https',
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: this.config.JWT_REFRESH_TTL_DAYS * 24 * 3600,
    });
  }
}
