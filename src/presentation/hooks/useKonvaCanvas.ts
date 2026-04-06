import Konva from 'konva';
import { useCallback, useRef, useState } from 'react';
import type { LineEntity } from '../../domain/entities/Canvas/Line';

export const useKonvaCanvas = () => {
  const [lines, setLines] = useState<LineEntity[]>([]);
  const isDrawing = useRef<boolean>(false);

  // 이벤트 타입을 구체화 (Konva.KonvaEventObject<MouseEvent>)
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    isDrawing.current = true;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;

    const newLine: LineEntity = {
      id: crypto.randomUUID(), // 최신 브라우저 표준 ID 생성
      points: [pos.x, pos.y],
      color: '#646cff',
      strokeWidth: 2,
    };

    setLines((prev) => [...prev, newLine]);
  }, []);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isDrawing.current) return;
    
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;

    setLines((prev) => {
      if (prev.length === 0) return prev;
      const lastLine = { ...prev[prev.length - 1] };
      // 성능을 위해 새로운 좌표만 추가
      lastLine.points = [...lastLine.points, pos.x, pos.y];
      return [...prev.slice(0, -1), lastLine];
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDrawing.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    setLines([]);
  }, []);

  return { lines, handleMouseDown, handleMouseMove, handleMouseUp, clearCanvas };
};