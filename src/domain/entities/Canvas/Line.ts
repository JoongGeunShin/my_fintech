export interface Point {
  x: number;
  y: number;
}

export interface LineEntity {
  id: string;
  points: number[]; // Konva Line은 [x1, y1, x2, y2...] 형태의 평탄화된 배열을 선호합니다.
  color: string;
  strokeWidth: number;
}