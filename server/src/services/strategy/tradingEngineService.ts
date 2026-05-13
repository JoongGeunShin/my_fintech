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
  TradeReason,
  VirtualPortfolio,
  VirtualPosition,
  VirtualTrade,
} from '../../types/strategy/types.js';
import { quantMetricsService } from './quantMetricsService.js';

// ── 상수 ──────────────────────────────────────────────────────
const STOP_LOSS_RATE     = -0.045;   // 고정 손절 상한 (-4.5%)
const TAKE_PROFIT_RATE   =  0.020;   // 1차 익절 (+2%)
const ENHANCED_PROFIT_RATE = 0.030;  // 고수익 유지/익절 (+3%)
const JUPO_QUICK_PROFIT  =  0.015;   // 주포 따라가기 빠른 익절 (+1.5%)
const RISK_PER_TRADE     =  0.05;    // 계좌 잔고 대비 최대 위험 5%
const MAX_POSITION_RATE  =  0.50;    // 단일 포지션 최대 50% 상한

const MIN_VRATE_TO_BUY   = 1.5;

const CYCLE_INTERVAL_MS  = 1_000;       // 1초마다 사이클
const REFRESH_INTERVAL_MS = 5 * 60_000; // 5분마다 종목 갱신

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

// ── 시장 시간대 판별 ───────────────────────────────────────────

function getMarketPhase(): MarketPhase {
  const now = new Date();
  const t   = now.getHours() * 60 + now.getMinutes();
  if (t < 480)  return 'CLOSED';
  if (t < 540)  return 'PRE_MARKET';
  if (t < 545)  return 'OPENING';        // 9:00~9:05
  if (t < 570)  return 'EARLY_MORNING';  // 9:05~9:30
  if (t < 690)  return 'MORNING_ACTIVE'; // 9:30~11:30
  if (t < 780)  return 'LUNCH_QUIET';    // 11:30~13:00
  if (t < 870)  return 'AFTERNOON_ACTIVE'; // 13:00~14:30
  if (t < 920)  return 'CLOSING_RUSH';   // 14:30~15:20
  if (t < 930)  return 'PRE_CLOSE';      // 15:20~15:30
  return 'CLOSED';
}

type BroadcastFn = (event: string, data: unknown) => void;

// ── 싱글턴 서비스 ─────────────────────────────────────────────

class TradingEngineService {
  private isRunning    = false;
  private checkTimer:   ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private broadcast:    BroadcastFn | null = null;
  private monitoredCodes = new Set<string>();

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

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Engine] 이미 실행 중');
      return;
    }

    try {
      this.portfolio = await getPortfolio();
      this.position  = await getPosition();
    } catch (err) {
      console.warn('[Engine] 상태 로드 실패 (기본값 사용):', err instanceof Error ? err.message : err);
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

    console.log('[Engine] 트레이딩 엔진 시작 (1초 사이클)');
    this._emitStatus();
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
    this.position = null;
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
      .filter((s) => s.score !== 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => ({ code: s.code, name: s.name, score: s.score, signal: s.signal }));

    return {
      isRunning:           this.isRunning,
      portfolio:           { ...this.portfolio },
      position:            this.position ? this._enrichPosition(this.position) : null,
      monitoredStockCount: this.monitoredCodes.size,
      topSignals,
      currentPhase:        phase,
      lastUpdated:         new Date(),
    };
  }

  // ── 내부: 종목 모니터링 갱신 ─────────────────────────────────

  private async _refreshMonitoredStocks(): Promise<void> {
    try {
      const conditionStocks = await getStocksByGroup('조건');

      let levelStocks = await getStocksByMinLevel(2);
      if (levelStocks.length === 0) levelStocks = await getStocksByMinLevel(1);

      const conditionCodes = new Set(conditionStocks.map((s) => s.code));
      const stocks = [
        ...conditionStocks,
        ...levelStocks.filter((s) => !conditionCodes.has(s.code)),
      ];

      const newCodes = new Set(stocks.map((s) => s.code));
      const posCode  = this.position?.code;

      for (const code of this.monitoredCodes) {
        if (!newCodes.has(code) && code !== posCode) {
          quantMetricsService.unsubscribe(code);
          this.monitoredCodes.delete(code);
        }
      }

      for (const stock of stocks) {
        if (!this.monitoredCodes.has(stock.code)) {
          quantMetricsService.subscribe(stock.code, stock.name);
          this.monitoredCodes.add(stock.code);
        }
      }

      console.log(
        `[Engine] 모니터링: 총 ${this.monitoredCodes.size}개` +
        ` (screened_조건: ${conditionStocks.length}개, levelStocks: ${levelStocks.length}개)`
      );
    } catch (err) {
      console.error('[Engine] 종목 갱신 실패:', err instanceof Error ? err.message : err);
    }
  }

  // ── 내부: 매매 사이클 (1초) ───────────────────────────────────

  private async _runCycle(): Promise<void> {
    if (!this.isRunning) return;

    const phase  = getMarketPhase();
    const config = PHASE_CONFIG[phase];

    // 마감 직전: 모든 포지션 강제 청산
    if (config.forceClose && this.position) {
      const state = quantMetricsService.getState(this.position.code);
      if (state) {
        console.log(`[Engine] ${phase} 강제 청산`);
        this._closePosition(state, 'MARKET_CLOSE');
        this._emitStatus();
        return;
      }
    }

    // 장 외 또는 금일 손실 후 포지션 없으면 정지
    if (phase === 'CLOSED') return;
    if (this.portfolio.dailyPnL < 0 && !this.position) {
      console.log('[Engine] 금일 손실 발생 → 자동매매 중단');
      await this.stop();
      this._emit('trading:halted', { reason: 'DAILY_LOSS', dailyPnL: this.portfolio.dailyPnL });
      return;
    }

    if (this.position) {
      this._managePosition(config);
    } else if (config.canEnter) {
      this._findAndEnter(config);
    }

    this._emitStatus();
  }

  // ── 내부: 포지션 관리 ─────────────────────────────────────────

  private _managePosition(config: PhaseConfig): void {
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
      this._closePosition(state, 'STOP_LOSS');
      return;
    }

    // ② 타임스탑 (시간대별 설정 적용, 손실 중일 때)
    if (heldMinutes >= config.timeStopMin && pnlRate < 0) {
      this._closePosition(state, 'TIME_STOP');
      return;
    }

    // ③ 주포 분산 감지 즉시 익절 (수익 중일 때만)
    if (pnlRate > 0 && state.majorPlayerPhase === 'distributing') {
      // 주포 따라가기 진입 시 더 민감하게 반응
      if (pos.isJupoFollow || pnlRate >= JUPO_QUICK_PROFIT) {
        this._closePosition(state, 'JUPO_EXIT');
        return;
      }
    }

    // ④ 주포 따라가기 빠른 익절 (+1.5%)
    if (pos.isJupoFollow && pnlRate >= JUPO_QUICK_PROFIT) {
      this._closePosition(state, 'JUPO_EXIT');
      return;
    }

    // ⑤ 고수익 구간 (+3%): 매수 신호 소멸 시 익절
    if (pnlRate >= ENHANCED_PROFIT_RATE) {
      if (state.cvdDirection !== 'up' || state.bor >= 0.9 || state.score < 0.3) {
        this._closePosition(state, 'ENHANCED_PROFIT');
        return;
      }
    }

    // ⑥ 기본 익절 (+2%): 신호 반전 시
    if (pnlRate >= TAKE_PROFIT_RATE) {
      if (state.signal === 'SELL' || state.cvdDirection === 'down') {
        this._closePosition(state, 'TAKE_PROFIT');
        return;
      }
    }

    this._emit('trading:position', {
      position: this.position,
      metrics:  stateSnapshot(state),
    });
  }

  // ── 내부: 진입 탐색 ───────────────────────────────────────────

  private _findAndEnter(config: PhaseConfig): void {
    if (this.portfolio.balance <= 0) return;

    const allStates = quantMetricsService.getAllStates();

    // 주포 따라가기 우선 탐색 (매도벽 소멸 + 주포 매집 신호)
    const jupoCandidate = allStates.find((s) =>
      s.wallAbsorbedAsk             &&    // 매도벽 소멸 (가장 강한 급등 신호)
      s.majorPlayerPhase === 'accumulating' &&
      s.majorPlayerScore > 0.5      &&
      s.cvdDirection === 'up'       &&
      s.currentPrice > 0
    );

    if (jupoCandidate) {
      this._enterPosition(jupoCandidate, config, true);
      return;
    }

    // 일반 신호 탐색
    const candidates = allStates
      .filter((s) =>
        s.signal  === 'BUY'                              &&
        s.score   >= config.minScore                     &&  // 시간대별 임계값
        (!s.vrateReliable || s.vrate >= MIN_VRATE_TO_BUY) &&
        s.currentPrice > 0                               &&
        s.borVariance < 0.15                             // 허수 주문 의심 종목 제외
      )
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return;
    this._enterPosition(candidates[0], config, false);
  }

  // ── 내부: 포지션 진입 (5% 위험 기반 포지션 사이징) ─────────────

  private _enterPosition(state: StockQuantState, _config: PhaseConfig, isJupoFollow: boolean): void {
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

    const actualAmount    = price * quantity;
    const actualRiskRate  = (quantity * Math.abs(price - stopLossPrice)) / this.portfolio.balance;

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
    this.portfolio.balance -= actualAmount;

    const trade: VirtualTrade = {
      code:       state.code,
      name:       state.name,
      side:       'BUY',
      price,
      quantity,
      amount:     actualAmount,
      executedAt: new Date(),
      reason:     'SIGNAL_BUY',
    };

    savePosition(this.position).catch(console.error);
    saveTrade(trade).catch(console.error);
    savePortfolio({ balance: this.portfolio.balance }).catch(console.error);

    console.log(
      `[Engine] 매수: ${state.name}(${state.code}) @ ${price.toLocaleString()}원 × ${quantity}주` +
      ` | Score: ${state.score.toFixed(2)} | 실위험: ${(actualRiskRate * 100).toFixed(2)}%` +
      ` | ATR: ${state.atr.toFixed(0)} | ES: ${state.executionStrength.toFixed(0)}%` +
      (isJupoFollow ? ' | [주포 따라가기]' : '')
    );
    this._emit('trading:order', { side: 'BUY', position: this.position, trade });
  }

  private _closePosition(state: StockQuantState, reason: TradeReason): void {
    const pos          = this.position!;
    const exitPrice    = state.currentPrice;
    const realizedPnL  = (exitPrice - pos.entryPrice) * pos.quantity;
    const pnlRate      = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;

    const trade: VirtualTrade = {
      code:       pos.code,
      name:       pos.name,
      side:       'SELL',
      price:      exitPrice,
      quantity:   pos.quantity,
      amount:     exitPrice * pos.quantity,
      executedAt: new Date(),
      realizedPnL,
      pnlRate,
      reason,
    };

    this.portfolio.balance    += exitPrice * pos.quantity;
    this.portfolio.dailyPnL   += realizedPnL;
    this.portfolio.totalTrades++;
    if (realizedPnL > 0) this.portfolio.winTrades++;

    const closedPos = { ...pos };
    this.position   = null;

    clearPosition().catch(console.error);
    saveTrade(trade).catch(console.error);
    savePortfolio({
      balance:     this.portfolio.balance,
      dailyPnL:    this.portfolio.dailyPnL,
      totalTrades: this.portfolio.totalTrades,
      winTrades:   this.portfolio.winTrades,
    }).catch(console.error);

    console.log(
      `[Engine] 매도: ${closedPos.name}(${closedPos.code}) @ ${exitPrice.toLocaleString()}원` +
      ` | 손익: ${realizedPnL.toLocaleString()}원 (${pnlRate.toFixed(2)}%)` +
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
