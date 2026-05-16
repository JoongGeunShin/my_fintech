import type Konva from 'konva';
import React, { useEffect, useState } from 'react';
import { Image as KonvaImage, Layer, Stage } from 'react-konva';
import type { LineEntity } from '../../../domain/entities/Canvas/Line';
import './Canvas.css';
import SketchyLine from './SketchyLine';

interface CanvasProps {
  lines: LineEntity[];
  onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseMove: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  width: number;
  height: number;
  backgroundImage?: string;
}

const Canvas: React.FC<CanvasProps> = ({
  lines,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  width,
  height,
  backgroundImage,
}) => {
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const [bgDims, setBgDims] = useState({ x: 0, y: 0, w: width, h: height });

  useEffect(() => {
    if (!backgroundImage) { setBgImg(null); return; }
    const img = new Image();
    img.src = backgroundImage;
    img.onload = () => {
      // 비율 유지하면서 캔버스에 맞게 스케일
      const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      setBgDims({ x: (width - w) / 2, y: (height - h) / 2, w, h });
      setBgImg(img);
    };
  }, [backgroundImage, width, height]);

  return (
    <div className="main-canvas-wrapper">
      <Stage
        width={width}
        height={height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <Layer>
          {bgImg && (
            <KonvaImage
              image={bgImg}
              x={bgDims.x}
              y={bgDims.y}
              width={bgDims.w}
              height={bgDims.h}
              opacity={0.9}
            />
          )}
          {lines.map((line) => (
            <SketchyLine
              key={line.id}
              points={line.points}
              color={line.color}
              strokeWidth={line.strokeWidth}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

export default Canvas;