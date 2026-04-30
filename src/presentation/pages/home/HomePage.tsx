import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Canvas from '../../components/Canvas/Canvas';
import RealtimePanel from '../../components/RealtimePanel/RealtimePanel';
import ScreeningPanel from '../../components/ScreeningPanel/ScreeningPanel';
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

  const { orderBook, isConnected: obConnected } = useRealtimeOrderBook(selectedCode);
  const { latestTrade, trades, isConnected: trConnected } = useRealtimeTrade(selectedCode, 50);

  const isConnected = obConnected || trConnected;

  // 캔버스 컨테이너의 실제 너비를 측정
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
    height: Math.max(300, windowHeight - 350),
  }), [canvasWidth, windowHeight]);

  const handleStockSelect = useCallback((code: string, name: string) => {
    setSelectedCode((prev) => prev === code ? null : code);
    setSelectedName((prev) => prev === name ? undefined : name);
  }, []);

  return (
    <div className="canvas-container">
      {/* 상단 상태 바 */}
      <div className="realtime-status">
        <div className="user-badge">
          <span className="dot pulse" />
          나의 활동량: <strong>{typeCount}</strong>
        </div>
        <h1>Collab Canvas</h1>
        <p>Excalidraw 스타일의 손맛을 느껴보세요!</p>
      </div>

      {/* 캔버스 */}
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

      {/* 하단 컨트롤 바 */}
      <section className="canvas-controls">
        <div id="docs">
          <h2>Brush Tools</h2>
          <button className="counter" onClick={clearCanvas}>Clear Canvas</button>
        </div>
        <div id="social">
          <h2>Active Users (3)</h2>
          <ul className="user-list">
            <li><span className="user-dot" style={{ background: '#646cff' }} /> 나 (그리는 중...)</li>
            <li><span className="user-dot" style={{ background: '#ff4646' }} /> 참여자 A (타이핑: {typeCount + 5})</li>
          </ul>
        </div>
      </section>

      {/* 하단 패널: 스크리닝(좌) + 실시간(우) */}
      <div className="bottom-panels">
        <ScreeningPanel
          byLevel={byLevel}
          topStocks={topStocks}
          otherGroups={otherGroups}
          isLoading={isLoading}
          error={error}
          selectedCode={selectedCode}
          onStockSelect={handleStockSelect}
        />
        <RealtimePanel
          code={selectedCode}
          name={selectedName}
          orderBook={orderBook}
          trades={trades}
          latestTrade={latestTrade}
          isConnected={isConnected}
        />
      </div>
    </div>
  );
}
