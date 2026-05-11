// 실시간 퀀트 지표 계산 엔진 (종목별 인메모리 상태 관리)
import type { StockQuantState } from '../../types/strategy/types.js';
import type {
  RealtimeOrderBook,
  RealtimeTrade,
} from '../kis/kisWebSocketService.js';
import { kisWebSocketService } from '../kis/kisWebSocketService.js';
import { calcATR, getMinuteBars } from '../kis/minuteChartService.js';
import { memCache } from '../../utils/cache.js';

const TIS_WINDOW     = 100;  // TIS 계산에 사용할 최근 틱 수
const WALL_MULTIPLIER = 3;   // 평균 대비 N배 이상 → 벽 판정

type SignalListener = (state: StockQuantState) => void;

class QuantMetricsService {
  private states        = new Map<string, StockQuantState>();
  private tisBuffers    = new Map<string, Array<{ buy: boolean; volume: number }>>();
  private obCallbacks   = new Map<string, (d: RealtimeOrderBook) => void>();
  private tradeCallbacks = new Map<string, (d: RealtimeTrade) => void>();
  private signalListeners: SignalListener[] = [];

  // ── 구독 관리 ──────────────────────────────────────────────

  subscribe(code: string, name: string): void {
    if (this.states.has(code)) return;

    this._initState(code, name);

    const obCb    = (d: RealtimeOrderBook) => this._onOrderBook(d);
    const tradeCb = (d: RealtimeTrade)     => this._onTrade(d);

    this.obCallbacks.set(code, obCb);
    this.tradeCallbacks.set(code, tradeCb);

    kisWebSocketService.subscribeOrderBook(code, obCb);
    kisWebSocketService.subscribeTrade(code, tradeCb);

    // ATR 비동기 조회 (캐시 활용)
    this._fetchATR(code);
    console.log(`[Quant] 구독 시작: ${name}(${code})`);
  }

  unsubscribe(code: string): void {
    const obCb    = this.obCallbacks.get(code);
    const tradeCb = this.tradeCallbacks.get(code);

    if (obCb) {
      kisWebSocketService.unsubscribeOrderBook(code, obCb);
      this.obCallbacks.delete(code);
    }
    if (tradeCb) {
      kisWebSocketService.unsubscribeTrade(code, tradeCb);
      this.tradeCallbacks.delete(code);
    }

    this.states.delete(code);
    this.tisBuffers.delete(code);
    console.log(`[Quant] 구독 해제: ${code}`);
  }

  unsubscribeAll(): void {
    for (const code of [...this.states.keys()]) this.unsubscribe(code);
  }

  // ── 조회 ───────────────────────────────────────────────────

  getState(code: string): StockQuantState | null {
    return this.states.get(code) ?? null;
  }

  getAllStates(): StockQuantState[] {
    return [...this.states.values()];
  }

  onSignal(listener: SignalListener): void {
    this.signalListeners.push(listener);
  }

  // ── 초기화 ─────────────────────────────────────────────────

  private _initState(code: string, name: string): void {
    this.states.set(code, {
      code, name,
      vwapNumerator:   0, vwapDenominator: 0, vwap: 0, vwapDeviation: 0,
      cvd: 0, cvdPrev: 0, cvdDirection: 'flat',
      recentBuyTicks: 0, recentSellTicks: 0, tis: 0.5,
      bor: 1.0, hasWallAsk: false, hasWallBid: false,
      currentMinute: '', currentMinuteVolume: 0,
      minuteVolumeHistory: [], vrate: 1.0, vrateReliable: false,
      currentPrice: 0, openPrice: 0, highPrice: 0, lowPrice: 0, accVolume: 0,
      atr: 0, atrFetched: false,
      score: 0, signal: 'HOLD',
      lastUpdated: new Date(),
    });
    this.tisBuffers.set(code, []);
  }

  private async _fetchATR(code: string): Promise<void> {
    const cacheKey = `atr:${code}`;
    const cached   = memCache.get<number>(cacheKey);
    if (cached !== null) {
      const s = this.states.get(code);
      if (s) { s.atr = cached; s.atrFetched = true; }
      return;
    }

    try {
      const bars = await getMinuteBars(code, 10);
      const atr  = calcATR(bars, 5);
      const s    = this.states.get(code);
      if (s) { s.atr = atr; s.atrFetched = true; }
      memCache.set(cacheKey, atr, 5 * 60 * 1000);
    } catch (err) {
      console.warn(`[Quant] ATR 조회 실패 (${code}):`, err instanceof Error ? err.message : err);
    }
  }

  // ── 호가 콜백 ──────────────────────────────────────────────

  private _onOrderBook(data: RealtimeOrderBook): void {
    const s = this.states.get(data.code);
    if (!s) return;

    // BOR = 매도잔량합 / 매수잔량합
    const totalAsk = data.totalAskVolume;
    const totalBid = data.totalBidVolume;
    s.bor = totalBid > 0 ? totalAsk / totalBid : 1.0;

    // 벽 감지: 개별 잔량이 평균의 N배 이상
    const allVols = [...data.askVolumes, ...data.bidVolumes];
    const avgVol  = allVols.length > 0
      ? allVols.reduce((a, v) => a + v, 0) / allVols.length
      : 0;
    const wallThreshold = avgVol * WALL_MULTIPLIER;
    s.hasWallAsk = data.askVolumes.some((v) => v > wallThreshold);
    s.hasWallBid = data.bidVolumes.some((v) => v > wallThreshold);

    s.lastUpdated = new Date();
    this._calcScore(s);
  }

  // ── 체결 콜백 ──────────────────────────────────────────────

  private _onTrade(data: RealtimeTrade): void {
    const s = this.states.get(data.code);
    if (!s) return;

    const price  = data.tradePrice;
    const volume = data.tradeVolume;

    // 가격 업데이트
    s.currentPrice = price;
    if (s.openPrice === 0 && data.openPrice > 0) s.openPrice = data.openPrice;
    if (data.highPrice > 0) s.highPrice = data.highPrice;
    if (data.lowPrice  > 0) s.lowPrice  = data.lowPrice;
    s.accVolume = data.accVolume;

    // VWAP
    s.vwapNumerator   += price * volume;
    s.vwapDenominator += volume;
    s.vwap             = s.vwapDenominator > 0 ? s.vwapNumerator / s.vwapDenominator : price;
    s.vwapDeviation    = s.vwap > 0 ? ((price - s.vwap) / s.vwap) * 100 : 0;

    // CVD
    s.cvdPrev = s.cvd;
    s.cvd    += data.netBidVolume;
    s.cvdDirection =
      s.cvd > s.cvdPrev ? 'up' : s.cvd < s.cvdPrev ? 'down' : 'flat';

    // TIS (circular buffer)
    const buf   = this.tisBuffers.get(data.code)!;
    const isBuy = data.netBidVolume > 0;
    buf.push({ buy: isBuy, volume });
    if (buf.length > TIS_WINDOW) buf.shift();

    const buyCount = buf.filter((t) => t.buy).length;
    s.recentBuyTicks  = buyCount;
    s.recentSellTicks = buf.length - buyCount;
    s.tis = buf.length > 0 ? buyCount / buf.length : 0.5;

    // VRate (세션 내 분봉 거래량 기반 근사치)
    const now    = new Date();
    const minute = now.getHours().toString().padStart(2, '0') +
                   now.getMinutes().toString().padStart(2, '0');

    if (s.currentMinute !== minute) {
      if (s.currentMinute !== '') {
        s.minuteVolumeHistory.push(s.currentMinuteVolume);
        if (s.minuteVolumeHistory.length > 30) s.minuteVolumeHistory.shift();
      }
      s.currentMinute       = minute;
      s.currentMinuteVolume = 0;
    }
    s.currentMinuteVolume += volume;
    s.vrateReliable = s.minuteVolumeHistory.length >= 3;

    if (s.vrateReliable) {
      const avgMinVol = s.minuteVolumeHistory.reduce((a, v) => a + v, 0) / s.minuteVolumeHistory.length;
      s.vrate = avgMinVol > 0 ? s.currentMinuteVolume / avgMinVol : 1.0;
    } else {
      s.vrate = 1.0;
    }

    s.lastUpdated = new Date();
    this._calcScore(s);
    this._emitIfSignal(s);
  }

  // ── 점수 계산 ──────────────────────────────────────────────

  private _calcScore(s: StockQuantState): void {
    // 각 지표를 -1 ~ +1 로 정규화
    // BOR: 0.7 이하 → +1, 1.3 이상 → -1
    const borNorm  = clamp(-(s.bor - 1.0) / 0.3, -1, 1);
    // TIS: 0.65 이상 → +1, 0.35 이하 → -1
    const tisNorm  = clamp((s.tis - 0.5) / 0.15, -1, 1);
    // CVD 방향: up → +0.7, down → -0.7, flat → 0
    const cvdNorm  = s.cvdDirection === 'up' ? 0.7 : s.cvdDirection === 'down' ? -0.7 : 0;
    // VWAP 이탈도: -0.3% 이하 → +1, +0.3% 이상 → -1
    const vwapNorm = clamp(-s.vwapDeviation / 0.3, -1, 1);

    s.score = clamp(
      borNorm  * 0.25 +
      tisNorm  * 0.30 +
      cvdNorm  * 0.25 +
      vwapNorm * 0.20,
      -1, 1
    );

    // 진입 조건 — VRate 데이터 부족 시 해당 조건 면제
    const vrateOK = !s.vrateReliable || s.vrate > 1.5;

    const isBuy =
      s.score >  0.6 && vrateOK && s.cvdDirection === 'up'  && s.bor < 0.9;
    const isSell =
      s.score < -0.6 && vrateOK && s.cvdDirection === 'down' && s.bor > 1.1;

    s.signal = isBuy ? 'BUY' : isSell ? 'SELL' : 'HOLD';
  }

  private _emitIfSignal(s: StockQuantState): void {
    if (s.signal === 'HOLD') return;
    for (const listener of this.signalListeners) {
      try { listener(s); } catch { /* ignore */ }
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export const quantMetricsService = new QuantMetricsService();
