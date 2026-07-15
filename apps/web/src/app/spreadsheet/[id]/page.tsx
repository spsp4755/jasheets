'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Spreadsheet from '@/components/spreadsheet/Spreadsheet';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function SpreadsheetPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [initialCharts, setInitialCharts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<any[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  // Prevent duplicate API calls
  const fetchedRef = useRef(false);

  // Auth check
  const { user, loading: authLoading } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [authLoading, user, router]);

  const loadSheet = useCallback((sheet: any) => {
    setActiveSheetId(sheet.id);
    const sheetData: any = {};
    if (sheet.cells) {
      sheet.cells.forEach((c: any) => {
        if (!sheetData[c.row]) sheetData[c.row] = {};
        sheetData[c.row][c.col] = { value: c.value, style: c.format, formula: c.formula };
      });
    }
    setData(sheetData);
    setInitialCharts(Array.isArray(sheet.charts) ? sheet.charts : []);
  }, []);

  const fetchSpreadsheet = useCallback(async (targetSheetId?: string | null) => {
    const res = await api.spreadsheets.get(id);
    setTitle(res.name || 'Untitled Spreadsheet');
    const loaded = res.sheets || [];
    setSheets(loaded);
    if (loaded.length > 0) {
      const target = loaded.find((s: any) => s.id === targetSheetId) || loaded[0];
      loadSheet(target);
    } else {
      setData({});
    }
  }, [id, loadSheet]);

  useEffect(() => {
    // Skip if already fetched, no id, or still checking auth
    if (fetchedRef.current || !id || authLoading || !user) {
      return;
    }

    fetchedRef.current = true;
    setLoading(true);

    fetchSpreadsheet()
      .catch(err => {
        console.error('Failed to load spreadsheet:', err);
        // Check if it's an auth error
        if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
          // Clear token and redirect to login
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user');
          router.replace('/login');
        } else {
          setError('Failed to load spreadsheet');
        }
      })
      .finally(() => setLoading(false));
  }, [id, authLoading, user, router, fetchSpreadsheet]);

  // 시트 전환: 최신 데이터를 다시 불러와 대상 시트를 로드 (자동 저장이 2초 디바운스라 최신 편집분 포함)
  const switchSheet = useCallback((sheetId: string) => {
    if (sheetId === activeSheetId) return;
    fetchSpreadsheet(sheetId).catch(e => console.error(e));
  }, [activeSheetId, fetchSpreadsheet]);

  const addSheet = useCallback(async () => {
    try {
      const created = await api.spreadsheets.addSheet(id, `시트${sheets.length + 1}`);
      await fetchSpreadsheet(created?.id);
    } catch (e) {
      console.error('Failed to add sheet:', e);
    }
  }, [id, sheets.length, fetchSpreadsheet]);

  // Show loading while checking auth
  if (authLoading) {
    return <div className="flex h-screen items-center justify-center">Checking authentication...</div>;
  }

  // Don't render anything if not authenticated (will redirect)
  if (!user) {
    return <div className="flex h-screen items-center justify-center">Redirecting to login...</div>;
  }

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (error) return <div className="flex h-screen items-center justify-center text-red-500">{error}</div>;

  return (
    <div className="flex h-screen flex-col">
      <div className="min-h-0 flex-1">
        <Spreadsheet key={activeSheetId} initialData={data} initialCharts={initialCharts} spreadsheetId={id} activeSheetId={activeSheetId} title={title} />
      </div>
      {/* Google Sheets 스타일 하단 시트 탭바 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-t border-[#e1e3e1] bg-white px-2">
        <button
          onClick={addSheet}
          title="시트 추가"
          className="flex h-7 w-7 items-center justify-center rounded-full text-xl leading-none text-[#444746] hover:bg-[#f1f3f4]"
        >
          +
        </button>
        <div className="flex h-full items-center gap-0.5 overflow-x-auto">
          {sheets.map((s: any) => (
            <button
              key={s.id}
              onClick={() => switchSheet(s.id)}
              className={
                s.id === activeSheetId
                  ? 'flex h-7 items-center gap-1 rounded bg-[#d3e3fd] px-3 text-[13px] font-medium text-[#0b57d0]'
                  : 'flex h-7 items-center rounded px-3 text-[13px] text-[#444746] hover:bg-[#f1f3f4]'
              }
            >
              {s.name || '시트'}
              {s.id === activeSheetId && <span className="text-[9px]">▼</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
