import type Konva from 'konva';
import React from 'react';
import { Layer, Stage } from 'react-konva';
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
}

const Canvas: React.FC<CanvasProps> = ({ 
  lines, 
  onMouseDown, 
  onMouseMove, 
  onMouseUp, 
  width, 
  height 
}) => {
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