'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  // Keycloak SSO 버튼 노출 여부
  useEffect(() => {
    fetch('/api/auth/sso')
      .then(r => r.json())
      .then(d => setSsoEnabled(!!d.keycloak))
      .catch(() => setSsoEnabled(false));
  }, []);

  // Keycloak 콜백 처리: /login?token=..&refresh=..&user=<base64>
  useEffect(() => {
    const token = searchParams.get('token');
    const user = searchParams.get('user');
    const ssoError = searchParams.get('sso_error');
    if (ssoError) {
      alert(`SSO 로그인 실패: ${ssoError}`);
      router.replace('/login');
      return;
    }
    if (token && user) {
      try {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user', atob(user.replace(/-/g, '+').replace(/_/g, '/')));
        const refresh = searchParams.get('refresh');
        if (refresh) localStorage.setItem('refresh_token', refresh);
        router.replace('/dashboard');
      } catch {
        alert('SSO 로그인 처리 중 오류가 발생했습니다');
      }
    }
  }, [searchParams, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { accessToken, user } = await api.auth.login(email, password);
      localStorage.setItem('auth_token', accessToken);
      localStorage.setItem('user', JSON.stringify(user));
      router.push('/dashboard');
    } catch (error) {
      alert('로그인에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#f0f2f5',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'
    }}>
      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '400px'
      }}>
        <h1 style={{ marginBottom: '1.5rem', textAlign: 'center', color: '#1a73e8' }}>JaSheets 로그인</h1>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#5f6368' }}>이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
              placeholder="이메일을 입력하세요"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#5f6368' }}>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
              placeholder="비밀번호를 입력하세요"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              backgroundColor: '#1a73e8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              opacity: isLoading ? 0.7 : 1
            }}
          >
            {isLoading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        {ssoEnabled && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0' }}>
              <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
              <span style={{ fontSize: '0.8rem', color: '#9aa0a6' }}>또는</span>
              <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
            </div>
            <a
              href="/api/auth/keycloak"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '0.75rem',
                border: '1px solid #dadce0',
                borderRadius: '4px',
                fontSize: '1rem',
                color: '#3c4043',
                textDecoration: 'none',
                fontWeight: 500,
                background: 'white',
              }}
            >
              🔐 Keycloak(SSO)으로 로그인
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
