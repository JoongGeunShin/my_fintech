import { useEffect, useMemo, useState } from 'react';
import Canvas from '../../components/Canvas/Canvas'; // 이전에 만든 Konva용 Canvas
import { useActivity } from '../../hooks/useActivity';
import { useKonvaCanvas } from '../../hooks/useKonvaCanvas';
import './Home.css';

export default function HomePage() {
  const { typeCount } = useActivity();
  const { lines, handleMouseDown, handleMouseMove, handleMouseUp, clearCanvas } = useKonvaCanvas();

  // 창 크기 추적 로직 (useWindowSize 훅 대체)
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { width, height } = windowSize;

  // 캔버스 크기를 동적으로 계산 (헤더와 푸터 여백 제외)
  const canvasDimensions = useMemo(() => ({
    width: width - 40,  // 좌우 여백 20px씩 제외
    height: height - 350 // 상단 바 + 하단 바 높이만큼 제외
  }), [width, height]);

  return (
    <div className="canvas-container">
      {/* 상단 상태 바 */}
      <div className="realtime-status">
        <div className="user-badge">
          <span className="dot pulse"></span>
          나의 활동량: <strong>{typeCount}</strong>
        </div>
        <h1>Collab Canvas</h1>
        <p>Excalidraw 스타일의 손맛을 느껴보세요!</p>
      </div>

      {/* 캔버스 영역: 계산된 크기를 Props로 전달 */}
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
          <button className="counter" onClick={clearCanvas}>
            Clear Canvas
          </button>
        </div>
        <div id="social">
          <h2>Active Users (3)</h2>
          <ul className="user-list">
            <li><span className="user-dot" style={{background: '#646cff'}}></span> 나 (그리는 중...)</li>
            <li><span className="user-dot" style={{background: '#ff4646'}}></span> 참여자 A (타이핑: {typeCount + 5})</li>
          </ul>
        </div>
      </section>
    </div>
  );
}