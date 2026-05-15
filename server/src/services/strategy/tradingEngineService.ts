// 자동매매 엔진 — 가상 포트폴리오 기반
import { getStocksByGroup, getStocksByMinLevel } from '../../repositories/screeningRepository.js';
import {
  INITIAL_BALANCE,
  clearPosition,
  getPortfolio,
  getPosition,
  resetPortfolio,
  savePortfolio,
  savePosition,
  saveTrade,
} from '../../repositories/virtualPortfolioRepository.js';
import type {
  MarketPhase,
  StockQuantState,
  TradingEngineStatus,
  TradingMode,
  TradeReason,
  VirtualPortfolio,
  VirtualPosition,
  VirtualTrade,
} from '../../types/strategy/types.js';
import {
  getAvailableCash,
  getRealPositions,
  placeBuyOrder,
  placeSellOrder,
} from '../kis/kisOrderService.js';
import { getKisScreenedStocks } from '../kis/kisScreeningService.js';
import { preMarketFilterService } from '../optional/preMarketFilterService.js';
import { quantMetricsService } from './quantMetricsService.js';

// ── 상수 ──────────────────────────────────────────────────────
const STOP_LOSS_RATE        = -0.045;  // 고정 손절 상한 (-4.5%)
const TAKE_PROFIT_RATE      =  0.020;  // 1차 익절 (+2%)
const ENHANCED_PROFIT_RATE  =  0.030;  // 고수익 유지/익절 (+3%)
const JUPO_QUICK_PROFIT     =  0.015;  // 주포 따라가기 빠른 익절 (+1.5%)
const RISK_PER_TRADE        =  0.05;   // 계좌 잔고 대비 최대 위험 5%
const MAX_POSITION_RATE     =  0.50;   // 단일 포지션 최대 50% 상한

// ── 수수료/세금 (KIS 온라인 기준) ──────────────────────────────
const COMMISSION_RATE      = 0.00015; // 수수료 0.015% (매수·매도 각각)
const TRANSACTION_TAX_RATE = 0.0015;  // 증권거래세 0.15% (KOSPI, 매도 시)

// ── 일간 손익 한도 ──────────────────────────────────────────────
const DAILY_LOSS_LIMIT   = -0.05;  // 일간 손실 -5% 이하 → 매매 중단

const MIN_VRATE_TO_BUY   = 1.5;

const CYCLE_INTERVAL_MS  = 1_000;       // 1초마다 사이클
const REFRESH_INTERVAL_MS = 5 * 60_000; // 5분마다 종목 갱신

// ── 과당매매 방지 ──────────────────────────────────────────────
const REENTRY_COOLDOWN_MS    = 5 * 60_000; // 청산 후 5분 재진입 금지
const MAX_CONSECUTIVE_LOSSES = 3;           // 연속 손실 허용 횟수
const LOSS_COOLDOWN_MS       = 8 * 60_000; // 연속 손실 시 8분 휴식
const TIME_STOP_BLACKLIST_MS  = 30 * 60_000; // 타임스탑 종목 30분 재진입 금지
const FAST_TIMESTOP_THRESHOLD = -0.015;      // -1.5% 이상 손실 → 타임스탑 시간 절반

// ── 실전 주문 pending 관리 ─────────────────────────────────────
const PENDING_SETTLE_MS  =  5_000; // 주문 접수 후 5초 차단 (시장가 체결 대기)
const PENDING_TIMEOUT_MS = 30_000; // 30초 초과 시 KIS 재동기화 후 포기

// ── KIS WebSocket 구독 상한 ────────────────────────────────────
// 실전: 40 TR ÷ 2(체결+호가) = 20종목 / 모의: 20 TR ÷ 2 = 10종목
const MAX_WS_STOCKS_REAL    = 20;
const MAX_WS_STOCKS_VIRTUAL = 10;

// ── 시간대별 설정 ──────────────────────────────────────────────
interface PhaseConfig {
  canEnter: boolean;   // 신규 진입 가능 여부
  minScore: number;    // 진입 최소 점수
  timeStopMin: number; // 타임스탑 (분)
  forceClose: boolean; // 보유 포지션도 강제 청산
}

const PHASE_CONFIG: Record<MarketPhase, PhaseConfig> = {
  CLOSED:           { canEnter: false, minScore: 0.8, timeStopMin: 3,  forceClose: false },
  PRE_MARKET:       { canEnter: false, minScore: 0.8, timeStopMin: 3,  forceClose: false },
  // 장 시작 직후 5분: 갭 매매 세력·허수 호가 잔존 → 진입 금지
  OPENING:          { canEnter: false, minScore: 0.8, timeStopMin: 3,  forceClose: false },
  // 9:05~9:30 장초반 모멘텀: 기회 많으나 변동성 큼 → 임계값 높임
  EARLY_MORNING:    { canEnter: true,  minScore: 0.72, timeStopMin: 4, forceClose: false },
  // 9:30~11:30 오전: KOSPI 가장 활발한 구간
  MORNING_ACTIVE:   { canEnter: true,  minScore: 0.60, timeStopMin: 5, forceClose: false },
  // 11:30~13:00 점심: 거래량 급감, 유동성 부족 → 진입 자제
  LUNCH_QUIET:      { canEnter: false, minScore: 0.75, timeStopMin: 3, forceClose: false },
  // 13:00~14:30 오후: 세력 재개, 활성
  AFTERNOON_ACTIVE: { canEnter: true,  minScore: 0.60, timeStopMin: 5, forceClose: false },
  // 14:30~15:20 마감 러시: 프로그램 매매 급증 → 타임스탑 단축
  CLOSING_RUSH:     { canEnter: true,  minScore: 0.65, timeStopMin: 3, forceClose: false },
  // 15:20~15:30 마감 직전: 진입 금지, 모든 포지션 강제 청산
  PRE_CLOSE:        { canEnter: false, minScore: 0.9, timeStopMin: 1,  forceClose: true  },
};

// ── KST 기준 분 단위 시각 (서버 타임존 무관) ──────────────────────
function kstMinutes(): number {
  // UTC+9 고정 계산 — 서버가 UTC 환경에 배포되어도 정확히 동작
  const kst = new Date(Date.now() + (new Date().getTimezoneOffset() + 540) * 60_000);
  return kst.getHours() * 60 + kst.getMinutes();
}

// ── 시장 시간대 판별 ───────────────────────────────────────────

function getMarketPhase(): MarketPhase {
  const t = kstMinutes();
  if (t < 480)  return 'CLOSED';
  if (t < 540)  return 'PRE_MARKET';
  if (t < 545)  return 'OPENING';          // 9:00~9:05
  if (t < 570)  return 'EARLY_MORNING';    // 9:05~9:30
  if (t < 690)  return 'MORNING_ACTIVE';   // 9:30~11:30
  if (t < 780)  return 'LUNCH_QUIET';      // 11:30~13:00
  if (t < 870)  return 'AFTERNOON_ACTIVE'; // 13:00~14:30
  if (t < 920)  return 'CLOSING_RUSH';     // 14:30~15:20
  if (t < 930)  return 'PRE_CLOSE';        // 15:20~15:30
  return 'CLOSED';
}

interface PendingOrder {
  type:     'BUY' | 'SELL';
  orderId:  string;
  code:     string;
  quantity: number;
  placedAt: Date;
}

type BroadcastFn = (event: string, data: unknown) => void;

// ── 싱글턴 서비스 ─────────────────────────────────────────────

class TradingEngineService {
  private isRunning    = false;
  private mode: TradingMode = 'virtual';
  private checkTimer:   ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private broadcast:    BroadcastFn | null = null;
  private monitoredCodes     = new Set<string>();
  private levelCodes         = new Set<string>(); // level 1/2/3 종목 (우선 진입 대상)
  private conditionOnlyCodes = new Set<string>(); // "조건" 그룹 전용 (폴백)

  private lastExitTime:        Date | null       = null;
  private consecutiveLosses:  number             = 0;
  private cooldownUntil:       Date | null       = null;
  private timeStopBlacklist:   Map<string, Date> = new Map();
  private pendingOrder:          PendingOrder | null = null;
  private _isCycleRunning        = false;
  private _hasUnmanagedPosition  = false; // 수동 매수 등 미관리 포지션 존재 시 신규 진입 차단

  private portfolio: VirtualPortfolio = {
    balance:        INITIAL_BALANCE,
    initialBalance: INITIAL_BALANCE,
    dailyPnL:       0,
    totalTrades:    0,
    winTrades:      0,
    isActive:       false,
  };
  private position: VirtualPosition | null = null;

  // ── 공개 API ────────────────────────────────────────────────

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  async start(mode: TradingMode = 'virtual'): Promise<void> {
    if (this.isRunning) {
      console.warn('[Engine] 이미 실행 중');
      return;
    }

    this.mode = mode;

    if (mode === 'real') {
      await this._syncRealPortfolio();
    } else {
      try {
        const saved   = await getPortfolio();
        const today   = new Date().toISOString().slice(0, 10);
        const pnlFresh = saved.dailyPnLDate === today;
        this.portfolio = { ...saved, dailyPnL: pnlFresh ? saved.dailyPnL : 0 };
        if (!pnlFresh && saved.dailyPnL !== 0) {
          console.log('[Engine] 날짜 변경 감지 → dailyPnL 리셋');
        }
        this.position  = await getPosition();
      } catch (err) {
        console.warn('[Engine] 상태 로드 실패 (기본값 사용):', err instanceof Error ? err.message : err);
      }
    }

    this.portfolio.isActive = true;
    this.isRunning = true;
    savePortfolio({ isActive: true }).catch(console.error);

    if (this.position) {
      quantMetricsService.subscribe(this.position.code, this.position.name);
      this.monitoredCodes.add(this.position.code);
    }

    await this._refreshMonitoredStocks();

    this.checkTimer   = setInterval(() => this._runCycle().catch(console.error), CYCLE_INTERVAL_MS);
    this.refreshTimer = setInterval(() => this._refreshMonitoredStocks().catch(console.error), REFRESH_INTERVAL_MS);

    console.log(`[Engine] 트레이딩 엔진 시작 (모드: ${mode}, 1초 사이클)`);
    this._emitStatus();
  }

  // ── 실전 포트폴리오 KIS 동기화 ──────────────────────────────
  private async _syncRealPortfolio(): Promise<void> {
    try {
      // 저장된 상태 먼저 로드 (장 중 재시작 시 dailyPnL·거래통계 복구)
      let saved: VirtualPortfolio | null = null;
      try {
        saved = await getPortfolio();
      } catch { /* 실패 시 초기값 사용 */ }

      const [availableCash, realPositions] = await Promise.all([
        getAvailableCash(),
        getRealPositions(),
      ]);

      // 잔고·기준잔고는 KIS 실값, dailyPnL·통계는 Firebase 복구
      // 저장 날짜가 오늘이 아니면 dailyPnL 리셋 (전날 손익이 오늘 한도에 영향 주는 것 방지)
      const today    = new Date().toISOString().slice(0, 10);
      const pnlFresh = saved?.dailyPnLDate === today;
      const dailyPnL = pnlFresh ? (saved?.dailyPnL ?? 0) : 0;
      if (!pnlFresh && (saved?.dailyPnL ?? 0) !== 0) {
        console.log('[Engine] 날짜 변경 감지 → dailyPnL 리셋');
      }

      this.portfolio = {
        balance:        availableCash,
        initialBalance: availableCash,  // 당일 시작 기준점으로 사용
        dailyPnL,
        totalTrades:    saved?.totalTrades ?? this.portfolio.totalTrades,
        winTrades:      saved?.winTrades   ?? this.portfolio.winTrades,
        isActive:       false,
      };

      // 현재 보유 포지션 동기화 (1개만 허용)
      if (realPositions.length > 0) {
        const pos = realPositions[0];
        const state = quantMetricsService.getState(pos.code);
        // 재시작 시 실제 진입 시각을 KIS API로 복원할 수 없으므로
        // 타임스탑이 즉시 발동하지 않도록 현재 시각에서 가장 긴 timeStopMin(5분)만큼 뺀 시점을 사용.
        // 손절·익절은 정상 동작하므로 안전에는 영향 없음.
        const safeEntryTime = new Date(Date.now() - 4 * 60_000); // 4분 전으로 가정
        this.position = {
          code:              pos.code,
          name:              pos.name,
          entryPrice:        pos.avgPrice,
          quantity:          pos.quantity,
          entryTime:         safeEntryTime,
          stopLossPrice:     pos.avgPrice * (1 + STOP_LOSS_RATE),
          takeProfitPrice:   pos.avgPrice * (1 + TAKE_PROFIT_RATE),
          currentPrice:      state?.currentPrice ?? pos.avgPrice,
          unrealizedPnL:     0,
          unrealizedPnLRate: 0,
          atrAtEntry:        state?.atr ?? 0,
          scoreAtEntry:      state?.score ?? 0,
          entryPhase:        getMarketPhase(),
        };
        console.log(`[Engine] 실전 포지션 동기화: ${pos.name}(${pos.code}) ${pos.quantity}주 @ ${pos.avgPrice} (진입시각 복원 불가 → 4분 전 가정)`);
      } else {
        this.position = null;
      }

      if (realPositions.length > 1) {
        console.warn(`[Engine] 실전 계좌에 ${realPositions.length}개 종목 보유 중. 첫 번째만 관리합니다.`);
        this._hasUnmanagedPosition = true;
      }

      console.log(`[Engine] 실전 잔고 동기화: ${availableCash.toLocaleString()}원`);
    } catch (err) {
      console.error('[Engine] 실전 포트폴리오 동기화 실패:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.checkTimer)   { clearInterval(this.checkTimer);   this.checkTimer   = null; }
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }

    this.portfolio.isActive = false;
    savePortfolio({ isActive: false }).catch(console.error);

    console.log('[Engine] 트레이딩 엔진 중지');
    this._emitStatus();
  }

  async reset(): Promise<void> {
    await this.stop();

    quantMetricsService.unsubscribeAll();
    this.monitoredCodes.clear();
    this.position          = null;
    this.lastExitTime      = null;
    this.consecutiveLosses = 0;
    this.cooldownUntil     = null;
    this.timeStopBlacklist.clear();
    this.pendingOrder      = null;
    this.portfolio = {
      balance:        INITIAL_BALANCE,
      initialBalance: INITIAL_BALANCE,
      dailyPnL:       0,
      totalTrades:    0,
      winTrades:      0,
      isActive:       false,
    };

    await resetPortfolio();
    console.log('[Engine] 포트폴리오 초기화 완료');
  }

  getStatus(): TradingEngineStatus {
    const phase      = getMarketPhase();
    const allStates  = quantMetricsService.getAllStates();
    const topSignals = allStates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => ({ code: s.code, name: s.name, score: s.score, signal: s.signal }));

    return {
      isRunning:           this.isRunning,
      mode:                this.mode,
      portfolio:           { ...this.portfolio },
      position:            this.position ? this._enrichPosition(this.position) : null,
      monitoredStockCount: this.monitoredCodes.size,
      topSignals,
      currentPhase:        phase,
      lastUpdated:         new Date(),
    };
  }

  getMode(): TradingMode { return this.mode; }

  // ── 내부: 종목 모니터링 갱신 ─────────────────────────────────

  private async _refreshMonitoredStocks(): Promise<void> {
    try {
      let levelStocks = await getStocksByMinLevel(2);
      if (levelStocks.length === 0) levelStocks = await getStocksByMinLevel(1);

      // level 코드 세트 갱신
      this.levelCodes = new Set(levelStocks.map((s) => s.code));

      // KIS 실시간 스크리닝 (장 중에만 의미 있음)
      const phase = getMarketPhase();
      let momentumStocks: Array<{ code: string; name: string }> = [];

      if (phase !== 'CLOSED' && phase !== 'PRE_MARKET') {
        const kisStocks = await getKisScreenedStocks();
        momentumStocks = kisStocks;
      }

      // KIS 스크리닝 결과 없으면 efriend "조건" 그룹 폴백
      if (momentumStocks.length === 0) {
        momentumStocks = await getStocksByGroup('조건');
        if (momentumStocks.length > 0) {
          console.log('[Engine] KIS 스크리닝 결과 없음 → efriend 조건 그룹 폴백');
        }
      }

      // level 종목과 중복 제거 (level 우선)
      const momentumOnly = momentumStocks.filter((s) => !this.levelCodes.has(s.code));
      this.conditionOnlyCodes = new Set(momentumOnly.map((s) => s.code));

      // 장전 필터 종목 (OPENING·EARLY_MORNING 구간에만 추가 — 장전 BOR 검증 완료 종목)
      let preMarketOnly: Array<{ code: string; name: string }> = [];
      if ((phase === 'OPENING' || phase === 'EARLY_MORNING') && preMarketFilterService.isReady()) {
        const pmList = preMarketFilterService.getFilteredList();
        preMarketOnly = pmList
          .filter((s) => !this.levelCodes.has(s.code) && !this.conditionOnlyCodes.has(s.code))
          .map((s) => ({ code: s.code, name: s.name }));
        if (preMarketOnly.length > 0)
          console.log(`[Engine] 장전 필터 종목 ${preMarketOnly.length}개 추가`);
      }

      // WebSocket 구독 목록: level 종목 + 장전 필터 + 모멘텀 후보
      let allStocks = [...levelStocks, ...preMarketOnly, ...momentumOnly];
      const posCode = this.position?.code;

      // KIS WebSocket 구독 상한 적용 (포지션 종목 우선 보장)
      const wsLimit = this.mode === 'real' ? MAX_WS_STOCKS_REAL : MAX_WS_STOCKS_VIRTUAL;
      if (allStocks.length > wsLimit) {
        if (posCode) {
          const idx = allStocks.findIndex((s) => s.code === posCode);
          if (idx > 0) {
            const [posStock] = allStocks.splice(idx, 1);
            allStocks.unshift(posStock);
          }
        }
        console.warn(`[Engine] WebSocket 상한(${wsLimit}종목) 초과 → ${allStocks.length - wsLimit}개 제외`);
        allStocks = allStocks.slice(0, wsLimit);
      }

      const newCodes = new Set(allStocks.map((s) => s.code));

      for (const code of this.monitoredCodes) {
        if (!newCodes.has(code) && code !== posCode) {
          quantMetricsService.unsubscribe(code);
          this.monitoredCodes.delete(code);
        }
      }

      for (const stock of allStocks) {
        if (!this.monitoredCodes.has(stock.code)) {
          quantMetricsService.subscribe(stock.code, stock.name);
          this.monitoredCodes.add(stock.code);
        }
      }

      console.log(
        `[Engine] 모니터링: 총 ${this.monitoredCodes.size}개` +
        ` (level: ${levelStocks.length}개 | 장전: ${preMarketOnly.length}개 | KIS모멘텀: ${momentumOnly.length}개)`
      );

      // 실전 모드: 포지션 없을 때 KIS 실잔고·미관리 포지션 동기화 (5분 주기)
      if (this.mode === 'real' && !this.position) {
        try {
          const [availableCash, realPositions] = await Promise.all([
            getAvailableCash(),
            getRealPositions(),
          ]);

          if (this.portfolio.balance !== availableCash) {
            console.log(`[Engine] 잔고 동기화: ${this.portfolio.balance.toLocaleString()} → ${availableCash.toLocaleString()}원`);
            this.portfolio.balance = availableCash;
            savePortfolio({ balance: availableCash }).catch(console.error);
          }

          if (realPositions.length > 0) {
            if (!this._hasUnmanagedPosition) {
              console.warn(
                `[Engine] ⚠️ 수동 매수 감지: KIS에 미관리 포지션 ${realPositions.length}개` +
                ` (${realPositions.map((p) => p.name).join(', ')}) → 신규 진입 차단`
              );
            }
            this._hasUnmanagedPosition = true;
          } else {
            if (this._hasUnmanagedPosition) {
              console.log('[Engine] 미관리 포지션 해소 확인 → 신규 진입 재개');
            }
            this._hasUnmanagedPosition = false;
          }
        } catch (err) {
          console.warn('[Engine] 잔고 동기화 실패:', err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error('[Engine] 종목 갱신 실패:', err instanceof Error ? err.message : err);
    }
  }

  // ── 내부: 매매 사이클 (1초) ───────────────────────────────────

  private async _runCycle(): Promise<void> {
    if (!this.isRunning || this._isCycleRunning) return;
    this._isCycleRunning = true;
    try {
      await this._runCycleImpl();
    } finally {
      this._isCycleRunning = false;
    }
  }

  private async _runCycleImpl(): Promise<void> {
    if (!this.isRunning) return;

    // ── 실전 주문 pending 처리 ──────────────────────────────────
    if (this.mode === 'real' && this.pendingOrder) {
      const elapsed = Date.now() - this.pendingOrder.placedAt.getTime();
      if (elapsed < PENDING_SETTLE_MS) {
        // 체결 대기 중 — 이번 사이클 전체 스킵 (중복 주문 방지)
        this._emitStatus();
        return;
      }
      if (elapsed >= PENDING_TIMEOUT_MS) {
        // 30초 초과 — KIS 실제 상태로 재동기화
        console.warn(
          `[Engine] 주문 타임아웃 (${this.pendingOrder.type} ${this.pendingOrder.code} #${this.pendingOrder.orderId}) → KIS 재동기화`
        );
        try { await this._syncRealPortfolio(); } catch { /* 동기화 실패 시 현 상태 유지 */ }
        this.pendingOrder = null;
        this._emitStatus();
        return;
      }
      // 5s~30s: 시장가 체결 완료로 간주 → pending 해제
      // SELL pending 해제 시 해당 사이클은 스킵 — 잔고 반영 전 신규 매수 방지
      const pendingType = this.pendingOrder.type;
      this.pendingOrder = null;
      if (pendingType === 'SELL') {
        this._emitStatus();
        return;
      }
    }

    const phase  = getMarketPhase();
    const config = PHASE_CONFIG[phase];

    // 마감 직전: 모든 포지션 강제 청산
    if (config.forceClose && this.position) {
      const state = quantMetricsService.getState(this.position.code);
      if (state && state.currentPrice > 0) {
        console.log(`[Engine] ${phase} 강제 청산`);
        await this._closePosition(state, 'MARKET_CLOSE');
      } else if (this.mode === 'real') {
        // WebSocket 가격 없어도 실전 모드는 시장가 매도 강행
        console.warn(`[Engine] ${phase} WebSocket 가격 없음 → 실전 시장가 강제 청산`);
        const result = await placeSellOrder(this.position.code, this.position.quantity);
        if (result.success) {
          console.log(`[Engine] 강제 청산 주문 접수 (주문번호 ${result.orderId})`);
          const pos = this.position;
          this.position = null;
          clearPosition().catch(console.error);
          this._emit('trading:order', { side: 'SELL', position: pos, reason: 'MARKET_CLOSE' });
        } else {
          console.error(`[Engine] 강제 청산 실패: ${result.errorMsg} — 수동 청산 필요`);
        }
      }
      this._emitStatus();
      return;
    }

    if (phase === 'CLOSED') {
      this._emitStatus();
      return;
    }

    // 일간 손익 한도 체크 (-5% ~ +5% 범위 이탈 시 중단)
    if (!this.position) {
      const dailyPnLRate = this.portfolio.dailyPnL / this.portfolio.initialBalance;
      if (dailyPnLRate <= DAILY_LOSS_LIMIT) {
        console.log(`[Engine] 일간 손실 한도 도달 (${(dailyPnLRate * 100).toFixed(2)}%) → 자동매매 중단`);
        await this.stop();
        this._emit('trading:halted', { reason: 'DAILY_LOSS', dailyPnL: this.portfolio.dailyPnL, dailyPnLRate });
        return;
      }
    }

    if (this.position) {
      await this._managePosition(config);
    } else if (config.canEnter) {
      await this._findAndEnter(config);
    }

    this._emitStatus();
  }

  // ── 내부: 포지션 관리 ─────────────────────────────────────────

  private async _managePosition(config: PhaseConfig): Promise<void> {
    const pos   = this.position!;
    const state = quantMetricsService.getState(pos.code);
    if (!state || state.currentPrice === 0) return;

    const currentPrice = state.currentPrice;
    const pnlRate      = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const heldMinutes  = (Date.now() - pos.entryTime.getTime()) / 60_000;

    this.position = {
      ...pos,
      currentPrice,
      unrealizedPnL:     (currentPrice - pos.entryPrice) * pos.quantity,
      unrealizedPnLRate: pnlRate * 100,
    };

    // ① 손절
    if (pnlRate <= STOP_LOSS_RATE) {
      await this._closePosition(state, 'STOP_LOSS');
      return;
    }

    // ② 타임스탑 — 손실 -1.5% 초과 시 허용 시간 절반으로 단축
    const effectiveTimeStop = pnlRate <= FAST_TIMESTOP_THRESHOLD
      ? Math.max(2, Math.floor(config.timeStopMin / 2))
      : config.timeStopMin;
    if (heldMinutes >= effectiveTimeStop && pnlRate < 0) {
      await this._closePosition(state, 'TIME_STOP');
      return;
    }

    // ③ 주포 분산 감지 즉시 익절 (수익 중일 때만)
    if (pnlRate > 0 && state.majorPlayerPhase === 'distributing') {
      if (pos.isJupoFollow || pnlRate >= JUPO_QUICK_PROFIT) {
        await this._closePosition(state, 'JUPO_EXIT');
        return;
      }
    }

    // ④ 주포 따라가기 빠른 익절 (+1.5%)
    if (pos.isJupoFollow && pnlRate >= JUPO_QUICK_PROFIT) {
      await this._closePosition(state, 'JUPO_EXIT');
      return;
    }

    // ⑤ 고수익 구간 (+3%): 매수 신호 소멸 시 익절
    if (pnlRate >= ENHANCED_PROFIT_RATE) {
      if (state.cvdDirection !== 'up' || state.bor >= 0.9 || state.score < 0.3) {
        await this._closePosition(state, 'ENHANCED_PROFIT');
        return;
      }
    }

    // ⑥ 기본 익절 (+2%): 신호 반전 시
    if (pnlRate >= TAKE_PROFIT_RATE) {
      if (state.signal === 'SELL' || state.cvdDirection === 'down') {
        await this._closePosition(state, 'TAKE_PROFIT');
        return;
      }
    }

    this._emit('trading:position', {
      position: this.position,
      metrics:  stateSnapshot(state),
    });
  }

  // ── 내부: 진입 탐색 ───────────────────────────────────────────

  private async _findAndEnter(config: PhaseConfig): Promise<void> {
    if (this.portfolio.balance <= 0) return;
    if (this._hasUnmanagedPosition) return; // 수동 매수 포지션 존재 시 신규 진입 차단

    const now = Date.now();

    // 청산 후 재진입 쿨다운
    if (this.lastExitTime && now - this.lastExitTime.getTime() < REENTRY_COOLDOWN_MS) {
      const remainSec = Math.ceil((REENTRY_COOLDOWN_MS - (now - this.lastExitTime.getTime())) / 1000);
      this._emit('trading:cooldown', { type: 'REENTRY', remainSec });
      return;
    }

    // 연속 손실 휴식 쿨다운
    if (this.cooldownUntil && now < this.cooldownUntil.getTime()) {
      const remainSec = Math.ceil((this.cooldownUntil.getTime() - now) / 1000);
      this._emit('trading:cooldown', { type: 'LOSS_STREAK', remainSec });
      return;
    }

    // 타임스탑 블랙리스트 만료 항목 정리 + 헬퍼
    for (const [code, t] of this.timeStopBlacklist) {
      if (now - t.getTime() >= TIME_STOP_BLACKLIST_MS) this.timeStopBlacklist.delete(code);
    }
    const isBlacklisted = (code: string) => this.timeStopBlacklist.has(code);

    const allStates = quantMetricsService.getAllStates();

    // 주포 따라가기 최우선 (그룹 무관 — 매도벽 소멸 + 주포 매집 신호)
    const jupoCandidate = allStates.find((s) =>
      !isBlacklisted(s.code)        &&
      !s.isLowLiquidity             &&
      s.wallAbsorbedAsk             &&
      s.majorPlayerPhase === 'accumulating' &&
      s.majorPlayerScore > 0.5      &&
      s.cvdDirection === 'up'       &&
      s.currentPrice > 0
    );
    if (jupoCandidate) {
      await this._enterPosition(jupoCandidate, config, true);
      return;
    }

    const isValid = (s: StockQuantState) =>
      !isBlacklisted(s.code)                           &&
      s.signal  === 'BUY'                              &&
      s.score   >= config.minScore                     &&
      (!s.vrateReliable || s.vrate >= MIN_VRATE_TO_BUY) &&
      s.currentPrice > 0                               &&
      s.borVariance < 0.15;

    // ① level 1/2/3 종목 우선 탐색
    const levelCandidates = allStates
      .filter((s) => this.levelCodes.has(s.code) && isValid(s))
      .sort((a, b) => b.score - a.score);

    if (levelCandidates.length > 0) {
      await this._enterPosition(levelCandidates[0], config, false);
      return;
    }

    // ② level 종목 신호 없을 때만 "조건" 그룹 폴백
    const conditionCandidates = allStates
      .filter((s) => this.conditionOnlyCodes.has(s.code) && isValid(s))
      .sort((a, b) => b.score - a.score);

    if (conditionCandidates.length > 0) {
      await this._enterPosition(conditionCandidates[0], config, false);
    }
  }

  // ── 내부: 포지션 진입 (5% 위험 기반 포지션 사이징) ─────────────

  private async _enterPosition(state: StockQuantState, _config: PhaseConfig, isJupoFollow: boolean): Promise<void> {
    const price = state.currentPrice;

    // 손절가 계산 (ATR 기반, 상한 -4.5%)
    const atrStop      = state.atr > 0 ? price - state.atr * 1.5 : price * (1 + STOP_LOSS_RATE);
    const stopLossPrice = Math.min(atrStop, price * (1 + STOP_LOSS_RATE));

    // ── 5% 위험 기반 포지션 사이징 ──
    // 손절까지 거리 비율 (예: 3% 손절이면 0.03)
    const stopDistance = Math.abs(price - stopLossPrice) / price;

    // 이 종목에서 잃어도 되는 최대 금액 = 잔고 × 5%
    const riskAmount = this.portfolio.balance * RISK_PER_TRADE;

    // 위험금액 / 손절율 = 적정 포지션 크기
    // ex) 손절 3%, 위험 5만원 → 포지션 = 5만/0.03 = 167만 (잔고 초과 시 잔고 상한 적용)
    const byRisk    = stopDistance > 0 ? riskAmount / stopDistance : riskAmount * 2;
    const maxAmount = this.portfolio.balance * MAX_POSITION_RATE;
    const amount    = Math.min(byRisk, maxAmount);
    const quantity  = Math.floor(amount / price);

    if (quantity === 0) return;

    const actualAmount   = price * quantity;
    const buyFee         = Math.round(actualAmount * COMMISSION_RATE);
    const actualRiskRate = (quantity * Math.abs(price - stopLossPrice)) / this.portfolio.balance;

    // ── 실전 모드: 미수금 방지 + KIS 주문 ────────────────────────
    if (this.mode === 'real') {
      let availableCash: number;
      try {
        availableCash = await getAvailableCash();
      } catch (err) {
        console.error('[Engine] 주문가능금액 조회 실패 → 매수 취소:', err instanceof Error ? err.message : err);
        return;
      }

      // 미수금 방지: 주문금액 + 수수료가 가용 현금을 초과하면 매수 불가
      if (actualAmount + buyFee > availableCash) {
        console.warn(
          `[Engine] 매수 취소 (미수금 방지): 주문금액 ${(actualAmount + buyFee).toLocaleString()}원 > 가용현금 ${availableCash.toLocaleString()}원`
        );
        return;
      }

      const result = await placeBuyOrder(state.code, quantity);
      if (!result.success) {
        console.error(`[Engine] 실전 매수 주문 실패 (${state.code}): ${result.errorMsg}`);
        return;
      }
      console.log(`[Engine] 실전 매수 주문 접수: 주문번호 ${result.orderId}`);
      this.pendingOrder = { type: 'BUY', orderId: result.orderId, code: state.code, quantity, placedAt: new Date() };
    }

    this.position = {
      code:              state.code,
      name:              state.name,
      entryPrice:        price,
      quantity,
      entryTime:         new Date(),
      stopLossPrice,
      takeProfitPrice:   price * (1 + (isJupoFollow ? JUPO_QUICK_PROFIT : TAKE_PROFIT_RATE)),
      currentPrice:      price,
      unrealizedPnL:     0,
      unrealizedPnLRate: 0,
      atrAtEntry:        state.atr,
      scoreAtEntry:      state.score,
      entryPhase:        getMarketPhase(),
      isJupoFollow,
    };
    this.portfolio.balance -= actualAmount + buyFee;

    const trade: VirtualTrade = {
      code:       state.code,
      name:       state.name,
      side:       'BUY',
      price,
      quantity,
      amount:     actualAmount,
      executedAt: new Date(),
      fees:       buyFee,
      reason:     'SIGNAL_BUY',
    };

    savePosition(this.position).catch(console.error);
    saveTrade(trade).catch(console.error);
    savePortfolio({ balance: this.portfolio.balance }).catch(console.error);

    console.log(
      `[Engine][${this.mode}] 매수: ${state.name}(${state.code}) @ ${price.toLocaleString()}원 × ${quantity}주` +
      ` | Score: ${state.score.toFixed(2)} | 실위험: ${(actualRiskRate * 100).toFixed(2)}%` +
      ` | ATR: ${state.atr.toFixed(0)} | ES: ${state.executionStrength.toFixed(0)}%` +
      (isJupoFollow ? ' | [주포 따라가기]' : '')
    );
    this._emit('trading:order', { side: 'BUY', position: this.position, trade });
  }

  private async _closePosition(state: StockQuantState, reason: TradeReason): Promise<void> {
    const pos        = this.position!;
    const exitPrice  = state.currentPrice;
    const sellAmount = exitPrice * pos.quantity;

    // ── 실전 모드: KIS 매도 주문 ──────────────────────────────────
    if (this.mode === 'real') {
      const result = await placeSellOrder(pos.code, pos.quantity);
      if (!result.success) {
        console.error(`[Engine] 실전 매도 주문 실패 (${pos.code}): ${result.errorMsg}`);
        // KIS 실제 잔고 확인 — 수동 매도 등으로 이미 없는 경우 강제 정리
        try {
          const realPositions = await getRealPositions();
          const stillHeld = realPositions.some((p) => p.code === pos.code);
          if (!stillHeld) {
            console.warn(`[Engine] KIS 포지션 없음 확인 (${pos.code}) → 수동 매도 추정, 포지션 강제 정리`);
            this.position = null;
            clearPosition().catch(console.error);
          }
          // stillHeld이면 일시적 API 오류 → 다음 사이클에 재시도
        } catch {
          // 조회 실패 시 현 상태 유지
        }
        return;
      }
      console.log(`[Engine] 실전 매도 주문 접수: 주문번호 ${result.orderId}`);
      this.pendingOrder = { type: 'SELL', orderId: result.orderId, code: pos.code, quantity: pos.quantity, placedAt: new Date() };
    }

    // KIS 수수료·세금 계산
    const buyFee  = Math.round(pos.entryPrice * pos.quantity * COMMISSION_RATE);
    const sellFee = Math.round(sellAmount * COMMISSION_RATE);
    const txTax   = Math.round(sellAmount * TRANSACTION_TAX_RATE);
    const totalFees = buyFee + sellFee + txTax;

    const realizedPnL = (exitPrice - pos.entryPrice) * pos.quantity - totalFees;
    const pnlRate     = (realizedPnL / (pos.entryPrice * pos.quantity)) * 100;

    const trade: VirtualTrade = {
      code:       pos.code,
      name:       pos.name,
      side:       'SELL',
      price:      exitPrice,
      quantity:   pos.quantity,
      amount:     sellAmount,
      executedAt: new Date(),
      realizedPnL,
      pnlRate,
      fees:       sellFee,
      tax:        txTax,
      reason,
    };

    this.portfolio.balance  += sellAmount - sellFee - txTax;
    this.portfolio.dailyPnL += realizedPnL;
    this.portfolio.totalTrades++;
    if (realizedPnL > 0) this.portfolio.winTrades++;

    const closedPos = { ...pos };
    this.position   = null;

    // 재진입 쿨다운 시작
    this.lastExitTime = new Date();

    // 타임스탑 종목 블랙리스트 등록
    if (reason === 'TIME_STOP') {
      this.timeStopBlacklist.set(closedPos.code, new Date());
      console.log(`[Engine] 타임스탑 블랙리스트: ${closedPos.name}(${closedPos.code}) → ${TIME_STOP_BLACKLIST_MS / 60_000}분 재진입 금지`);
    }

    // 연속 손실 추적
    if (realizedPnL <= 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
        this.cooldownUntil     = new Date(Date.now() + LOSS_COOLDOWN_MS);
        this.consecutiveLosses = 0;
        console.log(`[Engine] 연속 ${MAX_CONSECUTIVE_LOSSES}회 손실 → ${LOSS_COOLDOWN_MS / 60_000}분 휴식`);
        this._emit('trading:cooldown', { type: 'LOSS_STREAK', remainSec: LOSS_COOLDOWN_MS / 1000 });
      }
    } else {
      this.consecutiveLosses = 0;
    }

    clearPosition().catch(console.error);
    saveTrade(trade).catch(console.error);
    savePortfolio({
      balance:     this.portfolio.balance,
      dailyPnL:    this.portfolio.dailyPnL,
      totalTrades: this.portfolio.totalTrades,
      winTrades:   this.portfolio.winTrades,
    }).catch(console.error);

    console.log(
      `[Engine][${this.mode}] 매도: ${closedPos.name}(${closedPos.code}) @ ${exitPrice.toLocaleString()}원` +
      ` | 순손익: ${realizedPnL.toLocaleString()}원 (${pnlRate.toFixed(2)}%)` +
      ` | 수수료: ${(buyFee + sellFee).toLocaleString()}원 | 세금: ${txTax.toLocaleString()}원` +
      ` | 사유: ${reason}`
    );
    this._emit('trading:order', { side: 'SELL', position: closedPos, trade });
  }

  // ── 유틸 ──────────────────────────────────────────────────────

  private _enrichPosition(pos: VirtualPosition): VirtualPosition {
    const state = quantMetricsService.getState(pos.code);
    if (!state || state.currentPrice === 0) return pos;
    const p    = state.currentPrice;
    const rate = (p - pos.entryPrice) / pos.entryPrice;
    return {
      ...pos,
      currentPrice:      p,
      unrealizedPnL:     (p - pos.entryPrice) * pos.quantity,
      unrealizedPnLRate: rate * 100,
    };
  }

  private _emitStatus(): void {
    this._emit('trading:status', this.getStatus());
  }

  private _emit(event: string, data: unknown): void {
    this.broadcast?.(event, data);
  }
}

function stateSnapshot(s: StockQuantState) {
  return {
    code: s.code, name: s.name,
    score: s.score, signal: s.signal,
    bor: s.bor, tis: s.tis, cvd: s.cvd,
    executionStrength: s.executionStrength,
    nearBidDepth: s.nearBidDepth, nearAskDepth: s.nearAskDepth,
    vwap: s.vwap, vwapDeviation: s.vwapDeviation,
    vrate: s.vrate, currentPrice: s.currentPrice,
    majorPlayerScore: s.majorPlayerScore,
    majorPlayerPhase: s.majorPlayerPhase,
    wallAbsorbedAsk: s.wallAbsorbedAsk,
    cvdDivergence: s.cvdDivergence,
  };
}

export const tradingEngineService = new TradingEngineService();
