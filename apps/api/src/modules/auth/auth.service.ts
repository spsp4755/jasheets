import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar: string | null;
    isAdmin: boolean;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenResponse> {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    });

    return this.generateTokens(user);
  }

  async login(dto: LoginDto): Promise<TokenResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponse> {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Delete old session
    await this.prisma.session.delete({
      where: { id: session.id },
    });

    return this.generateTokens(session.user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { refreshToken },
    });
  }

  async validateUser(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  // --- Keycloak OIDC (폐쇄망 내부 SSO) -------------------------------------
  // 표준 인가 코드 플로우를 fetch 두 번으로 직접 구현 — passport 등 추가 의존성 없음.
  // KEYCLOAK_URL: 브라우저가 접근하는 주소 (예: http://keycloak.local)
  // KEYCLOAK_INTERNAL_URL: 백엔드→Keycloak 내부 주소 (미설정 시 KEYCLOAK_URL 사용)

  private get kc() {
    const url = this.configService.get<string>('KEYCLOAK_URL');
    const realm = this.configService.get<string>('KEYCLOAK_REALM');
    const clientId = this.configService.get<string>('KEYCLOAK_CLIENT_ID');
    const clientSecret = this.configService.get<string>('KEYCLOAK_CLIENT_SECRET');
    const appUrl = this.configService.get<string>('PUBLIC_APP_URL') || 'http://localhost:3000';
    const internalUrl = this.configService.get<string>('KEYCLOAK_INTERNAL_URL') || url;
    return { url, realm, clientId, clientSecret, appUrl, internalUrl };
  }

  isKeycloakEnabled(): boolean {
    const { url, realm, clientId, clientSecret } = this.kc;
    return !!(url && realm && clientId && clientSecret);
  }

  getKeycloakAuthUrl(): string {
    const { url, realm, clientId, appUrl } = this.kc;
    // state: 5분짜리 서명 토큰으로 CSRF 방지 (서버 세션 불필요)
    const state = this.jwtService.sign({ kc: true }, { expiresIn: '5m' });
    const params = new URLSearchParams({
      client_id: clientId!,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: `${appUrl}/api/auth/keycloak/callback`,
      state,
    });
    return `${url}/realms/${realm}/protocol/openid-connect/auth?${params.toString()}`;
  }

  async loginWithKeycloak(code: string, state: string): Promise<TokenResponse> {
    try {
      const decoded = this.jwtService.verify(state);
      if (!decoded?.kc) throw new Error('not a kc state');
    } catch {
      throw new UnauthorizedException('Invalid state parameter');
    }

    const { realm, clientId, clientSecret, appUrl, internalUrl } = this.kc;
    const tokenRes = await fetch(`${internalUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${appUrl}/api/auth/keycloak/callback`,
        client_id: clientId!,
        client_secret: clientSecret!,
      }),
    });
    if (!tokenRes.ok) {
      throw new UnauthorizedException(`Keycloak token exchange failed: ${await tokenRes.text()}`);
    }
    const kcTokens = await tokenRes.json();

    const userinfoRes = await fetch(`${internalUrl}/realms/${realm}/protocol/openid-connect/userinfo`, {
      headers: { Authorization: `Bearer ${kcTokens.access_token}` },
    });
    if (!userinfoRes.ok) {
      throw new UnauthorizedException('Keycloak userinfo request failed');
    }
    const info = await userinfoRes.json();

    const email = info.email || `${info.preferred_username}@keycloak.local`;
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // SSO 사용자는 로컬 비밀번호를 쓰지 않음 — 임의 값으로 채움
      user = await this.prisma.user.create({
        data: {
          email,
          name: info.name || info.preferred_username || email,
          password: await bcrypt.hash(randomUUID(), 10),
        },
      });
    }
    return this.generateTokens(user);
  }

  private async generateTokens(user: { id: string; email: string; name: string | null; avatar: string | null; isAdmin: boolean }): Promise<TokenResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.generateRefreshToken();

    // Save refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
      },
    };
  }

  private generateRefreshToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
