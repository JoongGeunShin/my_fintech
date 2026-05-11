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
  StockQuantState,
  TradingEngineStatus,
  TradeReason,
  VirtualPortfolio,
  VirtualPosition,
  VirtualTrade,
} from '../../types/strategy/types.js';
import { quantMetricsService } from './quantMetricsService.js';

// ── 상수 ──────────────────────────────────────────────────────
const STOP_LOSS_RATE     = -0.045;  // -4.5% 손절
const TAKE_PROFIT_RATE   =  0.020;  // +2.0% 1차 익절
const ENHANCED_PROFIT_RATE = 0.030; // +3.0% 고수익 유지/익절
const TIME_STOP_MINUTES  = 5;       // 5분 타임스탑
const POSITION_SIZE_RATE = 0.95;    // 잔고의 95% 투입
const MIN_SCORE_TO_BUY   = 0.6;
const MIN_VRATE_TO_BUY   = 1.5;
const CYCLE_INTERVAL_MS  = 5_000;   // 5초마다 사이클 실행
const REFRESH_INTERVAL_MS = 5 * 60_000; // 5분마다 종목 갱신

type BroadcastFn = (event: string, data: unknown) => void;

// ── 싱글턴 서비스 ─────────────────────────────────────────────

class TradingEngineService {
  private isRunning    = false;
  private checkTimer:   ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private broadcast:    BroadcastFn | null = null;
  private monitoredCodes = new Set<string>();

  // 인메모리 상태 (변경 시 Firestore에 비동기 저장)
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

    // Firestore에서 이전 상태 복구
    try {
      this.portfolio = await getPortfolio();
      this.position  = await getPosition();
    } catch (err) {
      console.warn('[Engine] 상태 로드 실패 (기본값 사용):', err instanceof Error ? err.message : err);
    }

    this.portfolio.isActive = true;
    this.isRunning = true;
    savePortfolio({ isActive: true }).catch(console.error);

    // 재시작 시 보유 포지션 종목 즉시 구독
    if (this.position) {
      quantMetricsService.subscribe(this.position.code, this.position.name);
      this.monitoredCodes.add(this.position.code);
    }

    await this._refreshMonitoredStocks();

    this.checkTimer   = setInterval(() => this._runCycle().catch(console.error), CYCLE_INTERVAL_MS);
    this.refreshTimer = setInterval(() => this._refreshMonitoredStocks().catch(console.error), REFRESH_INTERVAL_MS);

    console.log('[Engine] 트레이딩 엔진 시작');
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
    const allStates = quantMetricsService.getAllStates();
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
      lastUpdated:         new Date(),
    };
  }

  // ── 내부: 종목 모니터링 갱신 ─────────────────────────────────

  private async _refreshMonitoredStocks(): Promise<void> {
    try {
      // ① screened_조건 (최우선 — 점수 10+)
      const conditionStocks = await getStocksByGroup('조건');

      // ② my_fintech 레벨별
      let levelStocks = await getStocksByMinLevel(2);
      if (levelStocks.length === 0) levelStocks = await getStocksByMinLevel(1);

      // ③ 중복 제거 후 합산 (조건 종목 우선 배치)
      const conditionCodes = new Set(conditionStocks.map((s) => s.code));
      const stocks = [
        ...conditionStocks,
        ...levelStocks.filter((s) => !conditionCodes.has(s.code)),
      ];

      const newCodes   = new Set(stocks.map((s) => s.code));
      const posCode    = this.position?.code;

      // 스크리닝에서 제외된 종목 구독 해제 (보유 종목 제외)
      for (const code of this.monitoredCodes) {
        if (!newCodes.has(code) && code !== posCode) {
          quantMetricsService.unsubscribe(code);
          this.monitoredCodes.delete(code);
        }
      }

      // 신규 종목 구독
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

  // ── 내부: 매매 사이클 ─────────────────────────────────────────

  private async _runCycle(): Promise<void> {
    if (!this.isRunning) return;

    // 금일 손실 + 포지션 없음 → 자동 종료
    if (this.portfolio.dailyPnL < 0 && !this.position) {
      console.log('[Engine] 금일 손실 발생 → 자동매매 중단');
      await this.stop();
      this._emit('trading:halted', {
        reason:   'DAILY_LOSS',
        dailyPnL: this.portfolio.dailyPnL,
      });
      return;
    }

    if (this.position) {
      this._managePosition();
    } else {
      this._findAndEnter();
    }

    this._emitStatus();
  }

  // ── 내부: 포지션 관리 ─────────────────────────────────────────

  private _managePosition(): void {
    const pos   = this.position!;
    const state = quantMetricsService.getState(pos.code);
    if (!state || state.currentPrice === 0) return;

    const currentPrice = state.currentPrice;
    const pnlRate      = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const heldMinutes  = (Date.now() - pos.entryTime.getTime()) / 60_000;

    // 인메모리 포지션 갱신
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

    // ② 타임스탑 (5분 경과 + 손실)
    if (heldMinutes >= TIME_STOP_MINUTES && pnlRate < 0) {
      this._closePosition(state, 'TIME_STOP');
      return;
    }

    // ③ 고수익 구간 (3%+): 매수 신호 소멸 시 익절
    if (pnlRate >= ENHANCED_PROFIT_RATE) {
      if (state.cvdDirection !== 'up' || state.bor >= 0.9 || state.score < 0.3) {
        this._closePosition(state, 'ENHANCED_PROFIT');
        return;
      }
    }

    // ④ 기본 익절 (2%+): 신호 반전 시 익절
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

  private _findAndEnter(): void {
    if (this.portfolio.balance <= 0) return;

    const candidates = quantMetricsService.getAllStates()
      .filter((s) =>
        s.signal  === 'BUY' &&
        s.score   >= MIN_SCORE_TO_BUY &&
        (!s.vrateReliable || s.vrate >= MIN_VRATE_TO_BUY) &&
        s.currentPrice > 0
      )
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return;
    this._enterPosition(candidates[0]);
  }

  private _enterPosition(state: StockQuantState): void {
    const price    = state.currentPrice;
    const amount   = this.portfolio.balance * POSITION_SIZE_RATE;
    const quantity = Math.floor(amount / price);
    if (quantity === 0) return;

    const actualAmount = price * quantity;

    // ATR 기반 손절 (없으면 -4.5% 고정)
    const atrStop      = state.atr > 0 ? price - state.atr * 1.5 : price * (1 + STOP_LOSS_RATE);
    const stopLossPrice = Math.min(atrStop, price * (1 + STOP_LOSS_RATE));

    this.position = {
      code:              state.code,
      name:              state.name,
      entryPrice:        price,
      quantity,
      entryTime:         new Date(),
      stopLossPrice,
      takeProfitPrice:   price * (1 + TAKE_PROFIT_RATE),
      currentPrice:      price,
      unrealizedPnL:     0,
      unrealizedPnLRate: 0,
      atrAtEntry:        state.atr,
      scoreAtEntry:      state.score,
    };
    this.portfolio.balance -= actualAmount;

    const trade: VirtualTrade = {
      code:        state.code,
      name:        state.name,
      side:        'BUY',
      price,
      quantity,
      amount:      actualAmount,
      executedAt:  new Date(),
      reason:      'SIGNAL_BUY',
    };

    savePosition(this.position).catch(console.error);
    saveTrade(trade).catch(console.error);
    savePortfolio({ balance: this.portfolio.balance }).catch(console.error);

    console.log(
      `[Engine] 매수: ${state.name}(${state.code}) @ ${price.toLocaleString()}원 × ${quantity}주` +
      ` | Score: ${state.score.toFixed(2)} | ATR: ${state.atr.toFixed(0)}`
    );
    this._emit('trading:order', { side: 'BUY', position: this.position, trade });
  }

  private _closePosition(state: StockQuantState, reason: TradeReason): void {
    const pos       = this.position!;
    const exitPrice = state.currentPrice;
    const realizedPnL = (exitPrice - pos.entryPrice) * pos.quantity;
    const pnlRate     = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;

    const trade: VirtualTrade = {
      code:        pos.code,
      name:        pos.name,
      side:        'SELL',
      price:       exitPrice,
      quantity:    pos.quantity,
      amount:      exitPrice * pos.quantity,
      executedAt:  new Date(),
      realizedPnL,
      pnlRate,
      reason,
    };

    this.portfolio.balance    += exitPrice * pos.quantity;
    this.portfolio.dailyPnL   += realizedPnL;
    this.portfolio.totalTrades++;
    if (realizedPnL > 0) this.portfolio.winTrades++;

    const closedPos  = { ...pos };
    this.position    = null;

    clearPosition().catch(console.error);
    saveTrade(trade).catch(console.error);
    savePortfolio({
      balance:      this.portfolio.balance,
      dailyPnL:     this.portfolio.dailyPnL,
      totalTrades:  this.portfolio.totalTrades,
      winTrades:    this.portfolio.winTrades,
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
    const p     = state.currentPrice;
    const rate  = (p - pos.entryPrice) / pos.entryPrice;
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
    vwap: s.vwap, vwapDeviation: s.vwapDeviation,
    vrate: s.vrate, currentPrice: s.currentPrice,
  };
}

export const tradingEngineService = new TradingEngineService();
