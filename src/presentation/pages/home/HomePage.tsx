// src/presentation/pages/home/HomePage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Canvas from '../../components/Canvas/Canvas';
import RealtimePanel from '../../components/RealtimePanel/RealtimePanel';
import ScreeningPanel from '../../components/ScreeningPanel/ScreeningPanel';
import StockChart from '../../components/StockChart/StockChart';
import { useActivity } from '../../hooks/useActivity';
import { useKonvaCanvas } from '../../hooks/useKonvaCanvas';
import { useRealtimeOrderBook, useRealtimeTrade } from '../../hooks/useRealtimeStock';
import { useScreeningFirestore } from '../../hooks/useScreeningFirestore';
import './Home.css';

export default function HomePage() {
  const { typeCount } = useActivity();
  const { lines, handleMouseDown, handleMouseMove, handleMouseUp, clearCanvas } = useKonvaCanvas();

  const { byLevel, topStocks, otherGroups, isLoading, error } = useScreeningFirestore();

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | undefined>(undefined);
  const [chartVisible, setChartVisible] = useState(false);

  const { orderBook, isConnected: obConnected } = useRealtimeOrderBook(selectedCode);
  const { latestTrade, trades, isConnected: trConnected } = useRealtimeTrade(selectedCode, 50);

  const isConnected = obConnected || trConnected;

  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(window.innerWidth - 40);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setCanvasWidth(Math.max(300, width - 40));
    });
    ro.observe(wrapper);
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const canvasDimensions = useMemo(() => ({
    width: canvasWidth,
    height: Math.max(200, windowHeight - 420),
  }), [canvasWidth, windowHeight]);

  const handleStockSelect = useCallback((code: string, name: string) => {
    setSelectedCode((prev) => {
      const next = prev === code ? null : code;
      setChartVisible(next !== null);
      return next;
    });
    setSelectedName((prev) => prev === name ? undefined : name);
  }, []);

  // 초단기 그룹 추출 (otherGroups 중 "초단기" 포함 키 우선)
  // const shortTermKey = Object.keys(otherGroups).find((k) =>
  //   k.includes('초단기') || k.includes('단기') || k.includes('short')
  // ) ?? Object.keys(otherGroups)[0];
  // const shortTermStocks = shortTermKey ? (otherGroups[shortTermKey] ?? []) : [];

  return (
    <div className="home-root">

      {/* ── 상단 캔버스 섹션 ─────────────────────────────────── */}
      <div className="home-canvas-section">
        <div className="home-canvas-header">
          <div className="home-canvas-title">
            <span className="dot pulse" />
            Collab Canvas
          </div>
          <div className="home-canvas-meta">
            <span>활동량: <strong>{typeCount}</strong></span>
            <Link to="/trading" style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid rgba(170,59,255,0.4)',
              background: 'rgba(170,59,255,0.08)',
              color: 'var(--accent)',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>
              자동매매 →
            </Link>
            <button className="home-clear-btn" onClick={clearCanvas}>캔버스 초기화</button>
          </div>
        </div>
        <div className="main-canvas-wrapper" ref={canvasWrapperRef}>
          <Canvas
            lines={lines}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            width={canvasDimensions.width}
            height={canvasDimensions.height}
          />
        </div>
      </div>

      {/* ── 메인 패널 영역 ────────────────────────────────────── */}
      <div className="home-main">

        {/* ── 좌측: 스크리닝 랭킹 패널 (네이버페이 스타일) ───── */}
        <div className="home-screening-col">
          <ScreeningPanel
            byLevel={byLevel}
            topStocks={topStocks}
            otherGroups={otherGroups}
            isLoading={isLoading}
            error={error}
            selectedCode={selectedCode}
            onStockSelect={handleStockSelect}
          />
        </div>

        {/* ── 우측: 차트 + 호가/시세 ─────────────────────────── */}
        <div className={`home-chart-col ${chartVisible ? 'visible' : ''}`}>
          {!selectedCode ? (
            <div className="home-chart-empty">
              <span className="home-chart-empty-arrow">←</span>
              <p>좌측에서 종목을 선택하면</p>
              <p>차트와 실시간 호가가 표시됩니다</p>
            </div>
          ) : (
            <>
              {/* 차트 */}
              <div className="home-chart-wrap">
                <StockChart code={selectedCode} name={selectedName} />
              </div>

              {/* 호가 + 시세 */}
              <div className="home-realtime-wrap">
                <RealtimePanel
                  code={selectedCode}
                  name={selectedName}
                  orderBook={orderBook}
                  trades={trades}
                  latestTrade={latestTrade}
                  isConnected={isConnected}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
