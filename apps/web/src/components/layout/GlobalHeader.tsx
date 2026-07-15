'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import styles from './GlobalHeader.module.css';

export default function GlobalHeader() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  // Don't render on login page, admin pages, or if not authenticated
  if (!user || pathname === '/login' || pathname.startsWith('/admin') || pathname.startsWith('/spreadsheet')) { // 시트 편집 화면은 Google Sheets처럼 자체 메뉴바만 사용
    return null;
  }

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <Link href="/dashboard" className={styles.logo}>
          <div className={styles.logoIcon}>J</div>
          <span className={styles.title}>JaSheets</span>
        </Link>
      </div>
      
      <nav className={styles.nav}>
        <Link href="/dashboard" className={styles.navLink}>
          📊 대시보드
        </Link>
        {user.isAdmin && (
          <Link href="/admin" className={styles.navLink}>
            ⚙️ Admin
          </Link>
        )}
      </nav>
      
      <div className={styles.right}>
        <div className={styles.profile}>
          <div className={styles.avatar}>
            {(user.name || user.email || '?')[0].toUpperCase()}
          </div>
          <span className={styles.userName}>{user.name || user.email}</span>
          <button onClick={logout} className={styles.logoutButton}>
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
