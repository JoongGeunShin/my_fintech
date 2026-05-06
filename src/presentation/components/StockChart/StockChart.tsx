// src/presentation/components/StockChart/StockChart.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import './StockChart.css';

export interface CandleData {
  date: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  changeSign?: string;
}

type PeriodType = 'D' | 'M' | 'Y';

interface StockChartProps {
  code: string | null;
  name?: string;
}

// ✅ 서버 실제 라우트에 맞게 수정: /item/stocks/period/specified
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const COLOR = {
  UP:        '#ef4444',
  DOWN:      '#3b82f6',
  VOLUME_UP: 'rgba(239,68,68,0.5)',
  VOLUME_DN: 'rgba(59,130,246,0.5)',
  GRID:      'rgba(255,255,255,0.06)',
  AXIS:      'rgba(255,255,255,0.35)',
  BG:        '#131722',
  CROSS:     'rgba(255,255,255,0.45)',
  MA1:       '#f59e0b',
  MA2:       '#a855f7',
  MA3:       '#22d3ee',
};

function calcMA(data: CandleData[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const sum = data.slice(i - period + 1, i + 1).reduce((s, d) => s + d.closePrice, 0);
    return sum / period;
  });
}

function fmtDate(d: string, period: PeriodType): string {
  if (period === 'D' && d.length === 8) return `${d.slice(4, 6)}/${d.slice(6, 8)}`;
  if (period === 'M' && d.length === 8) return `${d.slice(0, 4)}/${d.slice(4, 6)}`;
  if (period === 'Y' && d.length === 8) return d.slice(0, 4);
  return d;
}

export default function StockChart({ code, name }: StockChartProps) {
  const chartRef  = useRef<HTMLCanvasElement>(null);
  const volRef    = useRef<HTMLCanvasElement>(null);
  const crossRef  = useRef<HTMLCanvasElement>(null);

  const [candles, setCandles]     = useState<CandleData[]>([]);
  const [period, setPeriod]       = useState<PeriodType>('D');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const [candleW, setCandleW]     = useState(10);
  const [cursor, setCursor]       = useState<{ x: number; y: number } | null>(null);
  const [hovIdx, setHovIdx]       = useState<number | null>(null);
  const [showMA, setShowMA]       = useState(true);

  // ── 데이터 패치 ───────────────────────────────────────────
  const fetchData = useCallback(async (c: string, p: PeriodType) => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const fmt = (d: Date) =>
        `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const endDate = fmt(today);
      const startDate = (() => {
        const d = new Date(today);
        if (p === 'D') d.setFullYear(d.getFullYear() - 1);
        if (p === 'M') d.setFullYear(d.getFullYear() - 5);
        if (p === 'Y') d.setFullYear(d.getFullYear() - 20);
        return fmt(d);
      })();

      // ✅ 올바른 경로
      const url = `${SERVER_URL}/item/stocks/period/specified?code=${c}&startDate=${startDate}&endDate=${endDate}&period=${p}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? '조회 실패');

      const raw: CandleData[] = (json.data.dailyPrices as CandleData[]).reverse();
      setCandles(raw);
      setViewStart(Math.max(0, raw.length - 80));
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!code) { setCandles([]); return; }
    fetchData(code, period);
    const timer = setInterval(() => fetchData(code, period), 60_000);
    return () => clearInterval(timer);
  }, [code, period, fetchData]);

  // ── 스크롤 → 줌 / 패닝 ───────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (Math.abs(e.deltaX) < 1) {
      // 위아래: 줌
      setCandleW((prev) => {
        const next = e.deltaY > 0 ? prev * 0.85 : prev * 1.18;
        return Math.max(3, Math.min(40, next));
      });
    } else {
      // 좌우: 패닝
      setViewStart((prev) => Math.max(0, prev + Math.round(e.deltaX / 20)));
    }
  }, []);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHovIdx(viewStart + Math.floor((e.clientX - rect.left) / candleW));
  }, [candleW, viewStart]);

  const handleMouseLeave = useCallback(() => { setCursor(null); setHovIdx(null); }, []);

  // ── 캔버스 렌더링 ─────────────────────────────────────────
  useEffect(() => {
    const canvas   = chartRef.current;
    const volCvs   = volRef.current;
    const crossCvs = crossRef.current;
    if (!canvas || !volCvs || !crossCvs) return;

    const W  = canvas.width  = canvas.offsetWidth;
    const CH = canvas.height = canvas.offsetHeight;
    const VH = volCvs.height = volCvs.offsetHeight;
    crossCvs.width = W; crossCvs.height = CH;

    const ctx  = canvas.getContext('2d')!;
    const vctx = volCvs.getContext('2d')!;
    const xctx = crossCvs.getContext('2d')!;

    ctx.fillStyle = COLOR.BG; ctx.fillRect(0, 0, W, CH);
    vctx.fillStyle = COLOR.BG; vctx.fillRect(0, 0, W, VH);

    if (candles.length === 0) {
      ctx.fillStyle = loading ? COLOR.AXIS : '#ef4444';
      ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(loading ? '로딩 중...' : (error ?? '데이터 없음'), W / 2, CH / 2);
      return;
    }

    const PAD_L = 10, PAD_R = 72, PAD_T = 20, PAD_B = 24;
    const plotW = W - PAD_L - PAD_R;
    const visibleCount = Math.floor(plotW / candleW);
    const start = Math.min(viewStart, Math.max(0, candles.length - visibleCount));
    const slice = candles.slice(start, start + visibleCount);
    if (!slice.length) return;

    const prices = slice.flatMap((c) => [c.highPrice, c.lowPrice]);
    let minP = Math.min(...prices), maxP = Math.max(...prices);
    const pad = (maxP - minP) * 0.08 || maxP * 0.01 || 1;
    minP -= pad; maxP += pad;
    const priceH = CH - PAD_T - PAD_B;
    const toY = (p: number) => PAD_T + (1 - (p - minP) / (maxP - minP)) * priceH;

    // 그리드 & 가격 레이블
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = PAD_T + (priceH / 5) * i;
      ctx.strokeStyle = COLOR.GRID;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.fillStyle = COLOR.AXIS; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText((maxP - ((maxP - minP) / 5) * i).toLocaleString('ko-KR', { maximumFractionDigits: 0 }), W - 4, y + 3);
    }

    // MA 선
    if (showMA) {
      [{ n: 5, c: COLOR.MA1 }, { n: 20, c: COLOR.MA2 }, { n: 60, c: COLOR.MA3 }].forEach(({ n, c }) => {
        const ma = calcMA(candles, n);
        ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.beginPath();
        let first = true;
        slice.forEach((_, i) => {
          const v = ma[start + i]; if (v === null) return;
          const x = PAD_L + i * candleW + candleW / 2;
          if (first) {
            ctx.moveTo(x, v);
          } else {
            ctx.lineTo(x, v);
          }
          first = false;
        });
        ctx.stroke();
      });
    }

    // 캔들
    slice.forEach((c, i) => {
      const isUp  = c.closePrice >= c.openPrice;
      const color = isUp ? COLOR.UP : COLOR.DOWN;
      const cx    = PAD_L + i * candleW + candleW / 2;
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, toY(c.highPrice)); ctx.lineTo(cx, toY(c.lowPrice)); ctx.stroke();
      const top = toY(Math.max(c.openPrice, c.closePrice));
      const bot = toY(Math.min(c.openPrice, c.closePrice));
      ctx.fillStyle = color;
      ctx.fillRect(PAD_L + i * candleW + candleW * 0.1, top, Math.max(1, candleW * 0.8), Math.max(1, bot - top));
    });

    // X축 날짜
    ctx.fillStyle = COLOR.AXIS; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(20 / candleW));
    slice.forEach((c, i) => {
      if (i % step !== 0) return;
      ctx.fillText(fmtDate(c.date, period), PAD_L + i * candleW + candleW / 2, CH - 6);
    });

    // 거래량
    const maxV = Math.max(...slice.map((c) => c.volume), 1);
    slice.forEach((c, i) => {
      vctx.fillStyle = c.closePrice >= c.openPrice ? COLOR.VOLUME_UP : COLOR.VOLUME_DN;
      const h = (c.volume / maxV) * (VH - 4);
      vctx.fillRect(PAD_L + i * candleW + candleW * 0.1, VH - h, Math.max(1, candleW * 0.8), h);
    });

    // 십자선
    xctx.clearRect(0, 0, W, CH);
    if (cursor && hovIdx !== null && hovIdx >= start && hovIdx < start + slice.length) {
      const li = hovIdx - start;
      const lx = PAD_L + li * candleW + candleW / 2;
      const ly = cursor.y;
      xctx.strokeStyle = COLOR.CROSS; xctx.lineWidth = 1; xctx.setLineDash([4, 4]);
      xctx.beginPath(); xctx.moveTo(lx, PAD_T); xctx.lineTo(lx, CH - PAD_B); xctx.stroke();
      xctx.beginPath(); xctx.moveTo(PAD_L, ly); xctx.lineTo(W - PAD_R, ly); xctx.stroke();
      xctx.setLineDash([]);
      const pVal = minP + (1 - (ly - PAD_T) / priceH) * (maxP - minP);
      xctx.fillStyle = 'rgba(0,0,0,0.75)';
      xctx.fillRect(W - PAD_R + 1, ly - 9, PAD_R - 2, 18);
      xctx.fillStyle = '#fff'; xctx.font = '10px monospace'; xctx.textAlign = 'center';
      xctx.fillText(pVal.toLocaleString('ko-KR', { maximumFractionDigits: 0 }), W - PAD_R / 2, ly + 4);
    }
  }, [candles, period, viewStart, candleW, cursor, hovIdx, loading, error, showMA]);

  const hovCandle = hovIdx !== null ? candles[hovIdx] : candles[candles.length - 1];
  if (!code) return null;

  return (
    <div className="sc-root">
      <div className="sc-toolbar">
        <div className="sc-info">
          <span className="sc-name">{name ?? code}</span>
          <span className="sc-code">{code}</span>
          {hovCandle && (
            <span className="sc-ohlc">
              <span>시 {hovCandle.openPrice.toLocaleString()}</span>
              <span>고 {hovCandle.highPrice.toLocaleString()}</span>
              <span>저 {hovCandle.lowPrice.toLocaleString()}</span>
              <span className={hovCandle.closePrice >= hovCandle.openPrice ? 'sc-up' : 'sc-dn'}>
                종 {hovCandle.closePrice.toLocaleString()}
              </span>
              <span className="sc-vol-label">거래량 {hovCandle.volume.toLocaleString()}</span>
            </span>
          )}
        </div>
        <div className="sc-controls">
          <button className={`sc-ma-btn ${showMA ? 'active' : ''}`} onClick={() => setShowMA((v) => !v)}>
            이동평균
          </button>
          {(['D', 'M', 'Y'] as PeriodType[]).map((p) => (
            <button key={p} className={`sc-period-btn ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
              {p === 'D' ? '일' : p === 'M' ? '월' : '년'}
            </button>
          ))}
          <button className="sc-refresh" onClick={() => code && fetchData(code, period)} title="새로고침">↺</button>
        </div>
      </div>

      <div className="sc-chart-area">
        <div className="sc-canvas-wrap">
          <canvas ref={chartRef} className="sc-canvas" />
          <canvas ref={crossRef} className="sc-cross-canvas" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
        </div>
        {loading && <div className="sc-loading">데이터 로딩 중...</div>}
        {!loading && error && <div className="sc-error">{error}</div>}
        <div className="sc-vol-area">
          <span className="sc-vol-title">거래량</span>
          <canvas ref={volRef} className="sc-vol-canvas" />
        </div>
      </div>

      <p className="sc-hint">↑↓ 스크롤: 줌 &nbsp;|&nbsp; 좌우 스크롤: 이동</p>
    </div>
  );
}
