// 실시간 퀀트 지표 계산 엔진 (종목별 인메모리 상태 관리)
import type { StockQuantState } from '../../types/strategy/types.js';
import type {
  RealtimeOrderBook,
  RealtimeTrade,
} from '../kis/kisWebSocketService.js';
import { kisWebSocketService } from '../kis/kisWebSocketService.js';
import { calcATR, getMinuteBars } from '../kis/minuteChartService.js';
import { memCache } from '../../utils/cache.js';

const TIS_WINDOW         = 100;   // TIS 계산 최근 틱 수
const ES_WINDOW          = 50;    // 체결강도 롤링 윈도우
const WALL_MULTIPLIER    = 3;     // 평균 대비 N배 이상 → 벽 판정
const PRICE_HISTORY      = 5;     // 단기 가격 추세 참조 틱 수
const BOR_HISTORY        = 10;    // BOR 변동성 추적 기록 수
const WALL_SIGNAL_HOLD_MS = 3_000; // 벽 소멸 신호를 3초간 유지 (1초 사이클 미스 방지)
// 분봉 평균 거래량 최소 기준: 이 미만이면 저유동성 종목으로 판단해 진입 차단
// 3,000주/분 ≈ 일평균 ~117만주 이상 (장 중 지속 유동성 확인용)
const MIN_AVG_MINUTE_VOL = 3_000;

type SignalListener = (state: StockQuantState) => void;

class QuantMetricsService {
  private states         = new Map<string, StockQuantState>();
  private tisBuffers     = new Map<string, Array<{ buy: boolean; volume: number }>>();
  private obCallbacks    = new Map<string, (d: RealtimeOrderBook) => void>();
  private tradeCallbacks = new Map<string, (d: RealtimeTrade) => void>();
  private signalListeners: SignalListener[] = [];

  // 날짜 변경 감지 (VWAP·CVD 당일 리셋용)
  private lastTradeDays = new Map<string, string>(); // code → 'YYYY-MM-DD'

  // 벽 소멸 신호 유지 타임스탬프 (호가 업데이트 빠를 때 1초 사이클 미스 방지)
  private wallAbsorbedAskUntil = new Map<string, number>(); // code → ms timestamp
  private wallAbsorbedBidUntil = new Map<string, number>();

  // ── 구독 관리 ──────────────────────────────────────────────

  subscribe(code: string, name: string): void {
    if (this.states.has(code)) return;

    this._initState(code, name);
    this.lastTradeDays.set(code, new Date().toISOString().slice(0, 10));

    const obCb    = (d: RealtimeOrderBook) => this._onOrderBook(d);
    const tradeCb = (d: RealtimeTrade)     => this._onTrade(d);

    this.obCallbacks.set(code, obCb);
    this.tradeCallbacks.set(code, tradeCb);

    kisWebSocketService.subscribeOrderBook(code, obCb);
    kisWebSocketService.subscribeTrade(code, tradeCb);

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
    this.lastTradeDays.delete(code);
    this.wallAbsorbedAskUntil.delete(code);
    this.wallAbsorbedBidUntil.delete(code);
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
      executionStrength: 50, execStrengthBuf: [],
      bor: 1.0, hasWallAsk: false, hasWallBid: false,
      nearAskDepth: 0, nearBidDepth: 0,
      wallAbsorbedAsk: false, wallAbsorbedBid: false,
      borHistory: [], borVariance: 0,
      currentMinute: '', currentMinuteVolume: 0,
      minuteVolumeHistory: [], vrate: 1.0, vrateReliable: false,
      avgMinuteVolume: 0, isLowLiquidity: false,
      currentPrice: 0, openPrice: 0, highPrice: 0, lowPrice: 0, accVolume: 0,
      priceHistory: [], priceTrend: 'flat',
      cvdDivergence: false,
      majorPlayerScore: 0, majorPlayerPhase: 'neutral',
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

    // 이전 벽 상태 저장 (소멸 감지용)
    const prevWallAsk = s.hasWallAsk;
    const prevWallBid = s.hasWallBid;

    // BOR = 매도잔량합 / 매수잔량합
    const totalAsk = data.totalAskVolume;
    const totalBid = data.totalBidVolume;
    s.bor = totalBid > 0 ? totalAsk / totalBid : 1.0;

    // 벽 감지: 개별 잔량이 평균의 N배 이상
    const allVols = [...data.askVolumes, ...data.bidVolumes];
    const avgVol  = allVols.length > 0
      ? allVols.reduce((a, v) => a + v, 0) / allVols.length : 0;
    const wallThreshold = avgVol * WALL_MULTIPLIER;
    s.hasWallAsk = data.askVolumes.some((v) => v > wallThreshold);
    s.hasWallBid = data.bidVolumes.some((v) => v > wallThreshold);

    // 벽 소멸 감지 — WALL_SIGNAL_HOLD_MS 동안 신호 유지 (호가가 사이클보다 빨라도 미스 없음)
    const nowMs = Date.now();
    if (prevWallAsk && !s.hasWallAsk) {
      this.wallAbsorbedAskUntil.set(data.code, nowMs + WALL_SIGNAL_HOLD_MS);
    }
    if (prevWallBid && !s.hasWallBid) {
      this.wallAbsorbedBidUntil.set(data.code, nowMs + WALL_SIGNAL_HOLD_MS);
    }
    s.wallAbsorbedAsk = (this.wallAbsorbedAskUntil.get(data.code) ?? 0) > nowMs;
    s.wallAbsorbedBid = (this.wallAbsorbedBidUntil.get(data.code) ?? 0) > nowMs;

    // 근접 호가 잔량 (1~3호가 합산 — 실제 매수/매도 가능 물량)
    s.nearAskDepth = data.askVolumes.slice(0, 3).reduce((a, v) => a + v, 0);
    s.nearBidDepth = data.bidVolumes.slice(0, 3).reduce((a, v) => a + v, 0);

    // BOR 변동성 추적 (허수 주문 감지)
    s.borHistory.push(s.bor);
    if (s.borHistory.length > BOR_HISTORY) s.borHistory.shift();
    if (s.borHistory.length >= 3) {
      const mean = s.borHistory.reduce((a, v) => a + v, 0) / s.borHistory.length;
      s.borVariance = s.borHistory.reduce((a, v) => a + (v - mean) ** 2, 0) / s.borHistory.length;
    }

    s.lastUpdated = new Date();
    this._calcScore(s);
  }

  // ── 체결 콜백 ──────────────────────────────────────────────

  private _onTrade(data: RealtimeTrade): void {
    const s = this.states.get(data.code);
    if (!s) return;

    // 날짜 바뀌면 당일 누적값 리셋 (VWAP·CVD·분봉 히스토리)
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastTradeDays.get(data.code) !== today) {
      this.lastTradeDays.set(data.code, today);
      s.vwapNumerator      = 0;
      s.vwapDenominator    = 0;
      s.vwap               = 0;
      s.cvd                = 0;
      s.cvdPrev            = 0;
      s.minuteVolumeHistory = [];
      s.vrateReliable      = false;
      s.accVolume          = 0;
      this.wallAbsorbedAskUntil.delete(data.code);
      this.wallAbsorbedBidUntil.delete(data.code);
      console.log(`[Quant] ${s.name}(${data.code}) 당일 누적값 리셋`);
    }

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

    // TIS (최근 N 틱 기반)
    const buf    = this.tisBuffers.get(data.code)!;
    const isBuy  = data.netBidVolume > 0;
    buf.push({ buy: isBuy, volume });
    if (buf.length > TIS_WINDOW) buf.shift();
    const buyCount = buf.filter((t) => t.buy).length;
    s.recentBuyTicks  = buyCount;
    s.recentSellTicks = buf.length - buyCount;
    s.tis = buf.length > 0 ? buyCount / buf.length : 0.5;

    // 체결강도 (롤링 50틱 거래량 가중 — 표준 HTS식)
    const buyVol  = Math.max(0, (volume + data.netBidVolume) / 2);
    const sellVol = Math.max(0, (volume - data.netBidVolume) / 2);
    s.execStrengthBuf.push({ buy: buyVol, sell: sellVol });
    if (s.execStrengthBuf.length > ES_WINDOW) s.execStrengthBuf.shift();
    const totalBuy  = s.execStrengthBuf.reduce((a, t) => a + t.buy,  0);
    const totalSell = s.execStrengthBuf.reduce((a, t) => a + t.sell, 0);
    const totalES   = totalBuy + totalSell;
    s.executionStrength = totalES > 0 ? (totalBuy / totalES) * 100 : 50;

    // VRate (분봉 거래량 비율)
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
      s.avgMinuteVolume = avgMinVol;
    } else {
      s.vrate = 1.0;
      s.avgMinuteVolume = 0;
    }

    // 단기 가격 추세 (최근 5 체결 기준)
    s.priceHistory.push(price);
    if (s.priceHistory.length > PRICE_HISTORY) s.priceHistory.shift();
    if (s.priceHistory.length >= 3) {
      const oldest = s.priceHistory[0];
      const newest = s.priceHistory[s.priceHistory.length - 1];
      const change = (newest - oldest) / oldest;
      s.priceTrend = change > 0.001 ? 'up' : change < -0.001 ? 'down' : 'flat';
    }

    s.lastUpdated = new Date();
    this._calcScore(s);
    this._emitIfSignal(s);
  }

  // ── 점수 계산 ──────────────────────────────────────────────

  private _calcScore(s: StockQuantState): void {
    // 1. 기존 지표 정규화
    const borNorm  = clamp(-(s.bor - 1.0) / 0.3, -1, 1);
    const tisNorm  = clamp((s.tis - 0.5) / 0.15, -1, 1);
    const cvdNorm  = s.cvdDirection === 'up' ? 0.7 : s.cvdDirection === 'down' ? -0.7 : 0;
    const vwapNorm = clamp(-s.vwapDeviation / 0.3, -1, 1);

    // 2. 체결강도 정규화 (65%→+1, 35%→-1)
    const esNorm = clamp((s.executionStrength - 50) / 15, -1, 1);

    // 3. CVD 다이버전스 — 가격방향 ≠ CVD방향 = 주포 개입
    s.cvdDivergence = (
      (s.priceTrend === 'down' && s.cvdDirection === 'up') ||   // 하락 중 CVD 상승 = 매집
      (s.priceTrend === 'up'   && s.cvdDirection === 'down')    // 상승 중 CVD 하락 = 분산
    );

    // 4. 주포 점수 산출
    let jupoScore = 0;
    // 가격하락 + CVD상승 → 저점 매집 (역발상 강세)
    if (s.priceTrend === 'down' && s.cvdDirection === 'up')   jupoScore += 0.45;
    // 가격상승 + CVD하락 → 고점 분산 (역발상 약세)
    if (s.priceTrend === 'up'   && s.cvdDirection === 'down') jupoScore -= 0.45;
    // 매도벽 소멸 → 저항 제거, 급등 임박 (가장 강한 매수 신호)
    if (s.wallAbsorbedAsk) jupoScore += 0.40;
    // 매수벽 소멸 → 지지 붕괴, 급락 임박
    if (s.wallAbsorbedBid) jupoScore -= 0.40;
    // 매수벽 유지 + CVD 상승 → 세력 지지선 형성
    if (s.hasWallBid && s.cvdDirection === 'up')   jupoScore += 0.20;
    // 매도벽 유지 + CVD 하락 → 세력 저항선 형성
    if (s.hasWallAsk && s.cvdDirection === 'down') jupoScore -= 0.20;

    s.majorPlayerScore = clamp(jupoScore, -1, 1);
    s.majorPlayerPhase =
      s.majorPlayerScore > 0.3  ? 'accumulating' :
      s.majorPlayerScore < -0.3 ? 'distributing' : 'neutral';

    // 5. 종합 점수 (가중합산)
    s.score = clamp(
      borNorm  * 0.20 +
      tisNorm  * 0.25 +
      cvdNorm  * 0.15 +
      vwapNorm * 0.15 +
      esNorm   * 0.15 +   // 체결강도 추가
      s.majorPlayerScore * 0.10,
      -1, 1
    );

    // 벽 소멸 즉시 점수 증폭 (주포 신호 극대화)
    if (s.wallAbsorbedAsk && s.score > 0.2) s.score = Math.min(s.score * 1.3, 1);
    if (s.wallAbsorbedBid && s.score < -0.2) s.score = Math.max(s.score * 1.3, -1);

    // 6. 저유동성 필터: 분봉 평균 거래량 기준 미달 시 진입 차단
    // vrateReliable(3분 이상 데이터) 이후부터 적용, 그 전에는 패스
    s.isLowLiquidity = s.vrateReliable && s.avgMinuteVolume < MIN_AVG_MINUTE_VOL;
    if (s.isLowLiquidity) {
      s.signal = 'HOLD';
      return;
    }

    // 7. 매매 신호 판정
    const vrateOK = !s.vrateReliable || s.vrate > 1.5;
    // 체결강도 60% 이상 OR 매도벽 소멸(즉각 진입)
    const esOK = s.executionStrength > 60 || s.wallAbsorbedAsk;

    const isBuy =
      s.score > 0.6   &&
      vrateOK          &&
      s.cvdDirection === 'up' &&
      s.bor < 0.9      &&
      esOK;

    const isSell =
      s.score < -0.6  &&
      vrateOK          &&
      s.cvdDirection === 'down' &&
      s.bor > 1.1;

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
