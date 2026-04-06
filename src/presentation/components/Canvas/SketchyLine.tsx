import { Context } from 'konva/lib/Context'; // Konva 전용 컨텍스트 타입
import React, { useMemo } from 'react';
import { Shape } from 'react-konva';
import rough from 'roughjs';

interface SketchyLineProps {
  points: number[];
  color: string;
  strokeWidth?: number;
}

const SketchyLine: React.FC<SketchyLineProps> = ({ points, color, strokeWidth = 2 }) => {
  const generator = useMemo(() => rough.generator(), []);

  // sceneFunc의 매개변수 타입을 정확히 지정 (any 제거)
  const sceneFunc = (context: Context) => {
    if (points.length < 4) return; // 점이 최소 2개(x,y,x,y)는 있어야 함

    const roughPoints: [number, number][] = [];
    for (let i = 0; i < points.length; i += 2) {
      roughPoints.push([points[i], points[i + 1]]);
    }

    const drawable = generator.linearPath(roughPoints, {
      stroke: color,
      strokeWidth: strokeWidth,
      roughness: 0.8, // Excalidraw 느낌을 위한 적정값
      bowing: 1.5,
    });

    // 가상 캔버스 테크닉으로 Rough.js 드로잉을 Konva에 주입
    const drawingCanvas = context.getCanvas()._canvas;
    const rc = rough.canvas(drawingCanvas);
    rc.draw(drawable);
  };

  return <Shape sceneFunc={sceneFunc} stroke={color} fill="transparent" />;
};

export default SketchyLine;