import { useEffect, useMemo, useState } from 'react';
import Canvas from '../../components/Canvas/Canvas';
import ScreeningPanel from '../../components/ScreeningPanel/ScreeningPanel';
import { useActivity } from '../../hooks/useActivity';
import { useKonvaCanvas } from '../../hooks/useKonvaCanvas';
import { useScreeningFirestore } from '../../hooks/useScreeningFirestore';
import './Home.css';

export default function HomePage() {
  const { typeCount } = useActivity();
  const { lines, handleMouseDown, handleMouseMove, handleMouseUp, clearCanvas } = useKonvaCanvas();

  // Socket.io 대신 Firestore 직접 구독
  const { byLevel, topStocks, lastRun, isLoading, error } = useScreeningFirestore();

  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const canvasDimensions = useMemo(() => ({
    width: windowSize.width - 40,
    height: Math.max(300, windowSize.height - 350),
  }), [windowSize]);

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
      <div className="main-canvas-wrapper">
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

      {/* 스크리닝 패널 - Firestore 실시간 구독 */}
      <ScreeningPanel
        byLevel={byLevel}
        topStocks={topStocks}
        lastRun={lastRun}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
