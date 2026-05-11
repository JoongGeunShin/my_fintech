// 퀀트 지표 상태 (종목별 인메모리)
export interface StockQuantState {
  code: string;
  name: string;

  // VWAP
  vwapNumerator: number;
  vwapDenominator: number;
  vwap: number;
  vwapDeviation: number; // (현재가 - VWAP) / VWAP × 100

  // CVD (Cumulative Volume Delta)
  cvd: number;
  cvdPrev: number;
  cvdDirection: 'up' | 'down' | 'flat';

  // TIS (Trade Intensity Score) — 최근 N 틱 기준
  recentBuyTicks: number;
  recentSellTicks: number;
  tis: number; // 0~1

  // BOR (매도잔량합 / 매수잔량합)
  bor: number;
  hasWallAsk: boolean; // 매도 벽 감지
  hasWallBid: boolean; // 매수 벽 감지

  // VRate (현재 분 거래량 / 최근 평균 분 거래량)
  currentMinute: string;        // HHmm
  currentMinuteVolume: number;
  minuteVolumeHistory: number[]; // 직전 완료 분봉 거래량들
  vrate: number;
  vrateReliable: boolean;        // 히스토리 충분(≥3) 여부

  // 가격
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  accVolume: number;

  // ATR (분봉 기반, HTTP 별도 조회)
  atr: number;
  atrFetched: boolean;

  // 종합
  score: number;  // -1 ~ +1
  signal: 'BUY' | 'SELL' | 'HOLD';

  lastUpdated: Date;
}

// 가상 포트폴리오
export interface VirtualPortfolio {
  balance: number;
  initialBalance: number;
  dailyPnL: number;
  totalTrades: number;
  winTrades: number;
  isActive: boolean;
}

// 가상 포지션 (한 번에 1개)
export interface VirtualPosition {
  code: string;
  name: string;
  entryPrice: number;
  quantity: number;
  entryTime: Date;
  stopLossPrice: number;
  takeProfitPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLRate: number;
  atrAtEntry: number;
  scoreAtEntry: number;
}

export type TradeReason =
  | 'SIGNAL_BUY'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TIME_STOP'
  | 'ENHANCED_PROFIT'
  | 'MANUAL';

export interface VirtualTrade {
  code: string;
  name: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  amount: number;
  executedAt: Date;
  realizedPnL?: number;
  pnlRate?: number;
  reason: TradeReason;
}

export interface TradingEngineStatus {
  isRunning: boolean;
  portfolio: VirtualPortfolio;
  position: VirtualPosition | null;
  monitoredStockCount: number;
  topSignals: Array<{ code: string; name: string; score: number; signal: string }>;
  lastUpdated: Date;
}
