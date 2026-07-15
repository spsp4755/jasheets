import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService, TokenResponse } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<TokenResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<TokenResponse> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokenResponse> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  // --- Keycloak OIDC ---

  /** 로그인 페이지가 SSO 버튼 노출 여부를 판단할 때 사용 */
  @Get('sso')
  ssoStatus() {
    return { keycloak: this.authService.isKeycloakEnabled() };
  }

  /** Keycloak 로그인 시작 — 인가 페이지로 리다이렉트 */
  @Get('keycloak')
  keycloakLogin(@Res() res: Response) {
    if (!this.authService.isKeycloakEnabled()) {
      throw new NotFoundException('Keycloak SSO is not configured');
    }
    res.redirect(this.authService.getKeycloakAuthUrl());
  }

  /** Keycloak 콜백 — 코드 교환 후 자체 JWT 발급, 프론트로 리다이렉트 */
  @Get('keycloak/callback')
  async keycloakCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
    try {
      const tokens = await this.authService.loginWithKeycloak(code, state);
      const user = Buffer.from(JSON.stringify(tokens.user)).toString('base64url');
      res.redirect(
        `${appUrl}/login?token=${encodeURIComponent(tokens.accessToken)}&refresh=${encodeURIComponent(tokens.refreshToken)}&user=${user}`,
      );
    } catch (e: any) {
      res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent(e?.message || 'SSO failed')}`);
    }
  }
}
