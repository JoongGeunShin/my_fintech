import { useEffect, useRef, useState } from 'react';
import './Home.css';

export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [typeCount, setTypeCount] = useState(0);

  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#646cff';
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  const startDrawing = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const draw = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => setIsDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    const handleKeyDown = () => setTypeCount(prev => prev + 1);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="canvas-container">
      <div className="realtime-status">
        <div className="user-badge">
          <span className="dot pulse"></span>
          나의 활동량: <strong>{typeCount}</strong>
        </div>
        <h1>Collab Canvas</h1>
        <p>화면에 그림을 그리거나 키보드를 입력해보세요!</p>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        className="main-canvas"
      />

      <section id="next-steps" className="canvas-controls">
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
  )
}