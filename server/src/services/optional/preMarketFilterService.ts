// 장전 동시호가 타임 종목 필터링 서비스
// 동작 순서: 8:40 스크리닝 → 8:50 스크리닝 → 8:57 허수 주문 필터 → 9:00 엔진에 전달
import { runFullScreening } from './screeningPipelineService.js';
import type { PreMarketStock } from '../../types/strategy/types.js';
import { quantMetricsService } from '../strategy/quantMetricsService.js';

// 허수 주문 판단 기준
// BOR 분산이 이 임계값 이상이면 허수 주문 가능성으로 제외
const BOR_VARIANCE_THRESHOLD = 0.12;

// 동시호가 기간 중 모니터링할 최대 종목 수 (WebSocket 슬롯 한계)
const MAX_PRE_MARKET_WATCH = 15;

class PreMarketFilterService {
  private snapshot840Codes = new Set<string>();  // 8:40 스크리닝 통과 코드
  private filteredList: PreMarketStock[] = [];
  private isWatching = false; // 장전 WebSocket 모니터링 중 여부

  // ── 8:40 실행: 1차 후보군 확보 및 WebSocket 모니터링 시작 ─────

  async runAt840(): Promise<void> {
    console.log('[PreMarket] 8:40 스크리닝 시작');
    try {
      const result = await runFullScreening();

      // 조건검색 통과 종목 + my_fintech 레벨 2 이상 종목 수집
      const conditionStocks = result.byGroup['조건'] ?? [];
      const levelStocks     = result.byLevel[3] ?? result.byLevel[2] ?? result.byLevel[1] ?? [];

      const uniqueCodes = new Set<string>();
      const allCandidates = [...conditionStocks, ...levelStocks];
      for (const s of allCandidates) uniqueCodes.add(s.code);

      this.snapshot840Codes = uniqueCodes;

      // 상위 MAX_PRE_MARKET_WATCH개 종목을 WebSocket 구독 시작
      // (kisWebSocketService가 H0STBSP0 시간외 호가도 자동 구독하므로 장전 데이터 수신됨)
      const watchList = allCandidates.slice(0, MAX_PRE_MARKET_WATCH);
      for (const s of watchList) {
        quantMetricsService.subscribe(s.code, s.name);
      }

      console.log(`[PreMarket] 8:40 후보: ${uniqueCodes.size}개 | 모니터링 시작: ${watchList.length}개`);
    } catch (err) {
      console.error('[PreMarket] 8:40 스크리닝 실패:', err instanceof Error ? err.message : err);
    }
  }

  // ── 8:50 실행: 메인 스크리닝 및 거래량 비율 검증 ──────────────

  async runAt850(): Promise<void> {
    console.log('[PreMarket] 8:50 스크리닝 시작');
    try {
      const result = await runFullScreening();

      const conditionStocks = result.byGroup['조건'] ?? [];
      const levelStocks3    = result.byLevel[3] ?? [];
      const levelStocks2    = result.byLevel[2] ?? [];

      // 8:40과 8:50 양쪽 스크리닝 통과 종목 = 더 신뢰할 수 있는 후보
      // (8:40 목록이 없으면 8:50 결과만 사용)
      const allStocks  = [...conditionStocks, ...levelStocks3, ...levelStocks2];
      const candidates = this.snapshot840Codes.size > 0
        ? allStocks.filter((s) => this.snapshot840Codes.has(s.code))
        : allStocks;

      const preMarketList: PreMarketStock[] = [];

      for (const stock of candidates) {
        const state = quantMetricsService.getState(stock.code);

        // WebSocket 데이터 수신 확인 (stock.price는 string)
        const currentPrice  = state?.currentPrice ?? (parseInt(stock.price, 10) || 0);
        const borAtSnapshot = state?.bor ?? 1.0;
        const borVariance   = state?.borVariance ?? 0;

        // tradeVolume은 efriend 스크리닝에서 받은 string → 숫자 변환
        const prevDayVolume   = parseInt(stock.tradeVolume, 10) || 1;
        const preMarketVolume = parseInt(stock.tradeVolume, 10) || 0;
        const volumeRatio     = prevDayVolume > 0 ? preMarketVolume / prevDayVolume : 0;

        preMarketList.push({
          code:              stock.code,
          name:              stock.name,
          preMarketVolume,
          prevDayVolume,
          volumeRatio,
          expectedOpenPrice: currentPrice,
          borAtSnapshot,
          borVariance,
          isReliable:        true, // 8:57 허수 필터에서 최종 판단
          selectedAt:        new Date(),
        });
      }

      // 임시 저장 (8:57 필터 전 단계)
      this.filteredList = preMarketList;
      console.log(`[PreMarket] 8:50 후보 확정: ${preMarketList.length}개`);
    } catch (err) {
      console.error('[PreMarket] 8:50 스크리닝 실패:', err instanceof Error ? err.message : err);
    }
  }

  // ── 8:57 실행: 허수 주문 필터링 ──────────────────────────────
  //
  // 허수 주문 패턴:
  //   ① 8:58~8:59 직전 BOR이 급격히 변동 (세력이 대량 주문 후 취소)
  //   ② BOR 분산이 높은 종목 = 호가창에 넣었다 빼는 허수 주문 가능성
  //   → borVariance >= BOR_VARIANCE_THRESHOLD 이면 제외

  runAt857(): void {
    console.log('[PreMarket] 8:57 허수 주문 필터링 시작');

    const before = this.filteredList.length;

    this.filteredList = this.filteredList.map((stock) => {
      const state = quantMetricsService.getState(stock.code);
      if (!state) return { ...stock, isReliable: false };

      // BOR 변동성 체크 (허수 주문 = BOR이 급격히 흔들림)
      const borVariance = state.borVariance;
      const isReliable  = borVariance < BOR_VARIANCE_THRESHOLD;

      return {
        ...stock,
        borAtSnapshot: state.bor,
        borVariance,
        expectedOpenPrice: state.currentPrice || stock.expectedOpenPrice,
        isReliable,
      };
    }).filter((s) => s.isReliable);

    console.log(
      `[PreMarket] 8:57 허수 필터 결과: ${before}개 → ${this.filteredList.length}개` +
      ` (${before - this.filteredList.length}개 제거)`
    );

    // 최종 리스트 로그
    for (const s of this.filteredList) {
      console.log(
        `[PreMarket] ✅ ${s.name}(${s.code})` +
        ` | 예상시가: ${s.expectedOpenPrice.toLocaleString()}원` +
        ` | BOR: ${s.borAtSnapshot.toFixed(2)} | BORVar: ${s.borVariance.toFixed(4)}`
      );
    }
  }

  // ── 결과 조회 ─────────────────────────────────────────────────

  getFilteredList(): PreMarketStock[] {
    return [...this.filteredList];
  }

  getFilteredCodes(): string[] {
    return this.filteredList.map((s) => s.code);
  }

  isReady(): boolean {
    return this.filteredList.length > 0;
  }

  // ── 장 시작 후 정리 ───────────────────────────────────────────

  clearPreMarketSubscriptions(): void {
    if (!this.isWatching) return;
    this.isWatching = false;
    this.snapshot840Codes.clear();
    console.log('[PreMarket] 장전 구독 정리 완료');
  }
}

export const preMarketFilterService = new PreMarketFilterService();
