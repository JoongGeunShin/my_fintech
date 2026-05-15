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

  // 체결강도 (표준 HTS식 — 50틱 롤링 거래량 기반)
  executionStrength: number;         // 0~100%
  execStrengthBuf: Array<{ buy: number; sell: number }>;

  // BOR (매도잔량합 / 매수잔량합)
  bor: number;
  hasWallAsk: boolean; // 매도 벽 감지
  hasWallBid: boolean; // 매수 벽 감지

  // 근접 호가 잔량 (1~3호가 합산)
  nearAskDepth: number; // 매도 1~3호가 잔량 합
  nearBidDepth: number; // 매수 1~3호가 잔량 합

  // 벽 소멸 (단일 사이클 플래그 — 다음 호가 업데이트 시 리셋)
  wallAbsorbedAsk: boolean; // 매도벽 소멸 → 급등 임박
  wallAbsorbedBid: boolean; // 매수벽 소멸 → 급락 임박

  // BOR 변동성 추적 (허수 주문 감지)
  borHistory: number[];  // 최근 10회 BOR 기록
  borVariance: number;   // 분산값 — 높으면 허수 주문 가능성

  // VRate (현재 분 거래량 / 최근 평균 분 거래량)
  currentMinute: string;        // HHmm
  currentMinuteVolume: number;
  minuteVolumeHistory: number[]; // 직전 완료 분봉 거래량들
  vrate: number;
  vrateReliable: boolean;        // 히스토리 충분(≥3) 여부
  avgMinuteVolume: number;       // 최근 분봉 평균 거래량 (vrateReliable 시 유효)
  isLowLiquidity: boolean;       // 저유동성 플래그 — 평균 분봉 거래량 기준 미달

  // 가격
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  accVolume: number;

  // 단기 가격 추세 (최근 5 체결 기준)
  priceHistory: number[];
  priceTrend: 'up' | 'down' | 'flat';

  // CVD 다이버전스 — 가격 방향 ≠ CVD 방향 → 주포 개입 신호
  cvdDivergence: boolean;

  // 주포(세력) 점수
  majorPlayerScore: number;  // -1~+1
  majorPlayerPhase: 'accumulating' | 'distributing' | 'neutral';

  // ATR (분봉 기반, HTTP 별도 조회)
  atr: number;
  atrFetched: boolean;

  // 종합
  score: number;  // -1 ~ +1
  signal: 'BUY' | 'SELL' | 'HOLD';

  lastUpdated: Date;
}

// 시장 시간대 구분 (KOSPI 기준)
export type MarketPhase =
  | 'CLOSED'             // 장 외
  | 'PRE_MARKET'         // 8:00~9:00 동시호가
  | 'OPENING'            // 9:00~9:05 장 시작 직후 (진입 금지)
  | 'EARLY_MORNING'      // 9:05~9:30 장초반 모멘텀 (임계값 높임)
  | 'MORNING_ACTIVE'     // 9:30~11:30 오전 활발 (정상 구간)
  | 'LUNCH_QUIET'        // 11:30~13:00 점심 한산 (진입 자제)
  | 'AFTERNOON_ACTIVE'   // 13:00~14:30 오후 활성
  | 'CLOSING_RUSH'       // 14:30~15:20 프로그램 매매 집중 (타임스탑 단축)
  | 'PRE_CLOSE';         // 15:20~15:30 마감 직전 (진입 금지, 보유분 청산)

// 장전 필터링된 종목 (8:40~8:57 스크리닝)
export interface PreMarketStock {
  code: string;
  name: string;
  preMarketVolume: number;   // 장전 누적 거래량 (추정)
  prevDayVolume: number;     // 전일 거래량
  volumeRatio: number;       // preMarketVolume / prevDayVolume
  expectedOpenPrice: number; // 예상 시가
  borAtSnapshot: number;     // 8:50 기준 BOR
  borVariance: number;       // BOR 분산 (낮을수록 신뢰)
  isReliable: boolean;       // 허수 주문 필터 통과 여부
  selectedAt: Date;
}

// 가상 포트폴리오
export interface VirtualPortfolio {
  balance: number;
  initialBalance: number;
  dailyPnL: number;
  dailyPnLDate?: string; // 'YYYY-MM-DD' — 날짜 변경 시 dailyPnL 리셋 판단용
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
  entryPhase?: MarketPhase;  // 진입 시 시장 시간대
  isJupoFollow?: boolean;    // 주포 따라가기 진입 여부
}

export type TradeReason =
  | 'SIGNAL_BUY'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TIME_STOP'
  | 'ENHANCED_PROFIT'
  | 'JUPO_EXIT'      // 주포 분산 감지 즉시 익절
  | 'MARKET_CLOSE'   // 장 마감 강제 청산 (15:20)
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
  fees?: number;   // 수수료 (매수/매도 각각 0.015%)
  tax?: number;    // 증권거래세 (매도 시 KOSPI 0.15%)
  reason: TradeReason;
}

export type TradingMode = 'virtual' | 'real';

export interface TradingEngineStatus {
  isRunning: boolean;
  mode: TradingMode;
  portfolio: VirtualPortfolio;
  position: VirtualPosition | null;
  monitoredStockCount: number;
  topSignals: Array<{ code: string; name: string; score: number; signal: string }>;
  currentPhase: MarketPhase;
  lastUpdated: Date;
}
