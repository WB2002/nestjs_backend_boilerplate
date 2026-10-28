import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { Public } from '@/common/decorators';
import { ACCESS_TOKEN_COOKIE, SESSION_ID_COOKIE } from '@/common/constants';
import {
  getAccessTokenCookieOptions,
  getSessionIdCookieOptions,
} from '@/common/utils';
import { ConfigService } from '@nestjs/config';
import { AuthRequest } from './types/auth.types';
import { CsrfTokenService } from '@/core/csrf/csrf-token.service';
import { setCsrfCookie } from '@/core/csrf/helpers/set-csrf-cookie';
import { ApiPriority, ApiPriorityLevel } from '@/core/overload';

@ApiPriority(ApiPriorityLevel.Critical)
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
    private readonly csrfTokenService: CsrfTokenService,
  ) {}

  @Public()
  @Get('csrf')
  getCsrf(@Res({ passthrough: true }) res: FastifyReply) {
    const csrfToken = this.csrfTokenService.generateToken();
    setCsrfCookie(res, csrfToken);
    return { csrfToken };
  }

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    await this.authService.register(registerDto);
    return { message: 'User registered successfully' };
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() _loginDto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { accessToken, sessionId } = await this.authService.createSession(
      req.user.id,
      req.headers['user-agent'],
      req.ip,
    );

    const accessTokenTtl = this.configService.get<number>(
      'ACCESS_TOKEN_TTL',
      900,
    );
    const sessionTtl = this.configService.get<number>('SESSION_TTL', 604800);

    res.setCookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      getAccessTokenCookieOptions(accessTokenTtl),
    );
    res.setCookie(
      SESSION_ID_COOKIE,
      sessionId,
      getSessionIdCookieOptions(sessionTtl),
    );

    const csrfToken = this.csrfTokenService.generateToken();
    setCsrfCookie(res, csrfToken);

    return {
      accessToken,
      sessionId,
      csrfToken,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: FastifyRequest,
    @Body('sessionId') sessionIdBody: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const incomingSessionId = req.cookies[SESSION_ID_COOKIE] || sessionIdBody;
    const { accessToken, sessionId } =
      await this.authService.refreshSession(incomingSessionId);

    const accessTokenTtl = this.configService.get<number>(
      'ACCESS_TOKEN_TTL',
      900,
    );
    const sessionTtl = this.configService.get<number>('SESSION_TTL', 604800);

    res.setCookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      getAccessTokenCookieOptions(accessTokenTtl),
    );
    res.setCookie(
      SESSION_ID_COOKIE,
      sessionId,
      getSessionIdCookieOptions(sessionTtl),
    );

    const csrfToken = this.csrfTokenService.generateToken();
    setCsrfCookie(res, csrfToken);

    return {
      accessToken,
      sessionId,
      csrfToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: AuthRequest,
    @Body('sessionId') sessionIdBody: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const sessionId =
      req.cookies[SESSION_ID_COOKIE] || sessionIdBody || req.user.jti;
    await this.authService.logout(sessionId);

    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(SESSION_ID_COOKIE, { path: '/auth/refresh' });

    return { message: 'Logged out successfully' };
  }
}
