// 장전 동시호가 타임 종목 필터링 서비스 (KIS API 기반)
// 동작 순서: 8:40 KIS 스크리닝 → 8:50 WebSocket 검증 → 8:57 허수 주문 제거 → 9:00 슬롯 반환
import type { PreMarketStock } from '../../types/strategy/types.js';
import {
  fetchPrevDayVolumes,
  getKisPreMarketCandidates,
} from '../kis/kisScreeningService.js';
import { quantMetricsService } from '../strategy/quantMetricsService.js';

// 허수 주문 판단 기준 (BOR 분산이 이 값 이상이면 허수 주문 가능성)
const BOR_VARIANCE_THRESHOLD = 0.12;

// 장전 WebSocket 모니터링 상한
// 실전 20종목 / 모의 10종목 가능하나 9:00 이후 엔진 구독 여유 확보를 위해 8개로 제한
const MAX_PRE_MARKET_WATCH = 8;

class PreMarketFilterService {
  private snapshot840Codes = new Map<string, { name: string; price: number; changeRate: number }>();
  private prevDayVolumeMap = new Map<string, number>();
  private filteredList: PreMarketStock[] = [];
  private watchedCodes  = new Set<string>();
  private isWatching    = false;

  // ── 8:40 실행: KIS 거래량 순위 기반 1차 후보 확보 + WebSocket 모니터링 시작 ──

  async runAt840(): Promise<void> {
    console.log('[PreMarket] 8:40 KIS 스크리닝 시작');
    try {
      const candidates = await getKisPreMarketCandidates();
      if (candidates.length === 0) {
        console.warn('[PreMarket] 8:40 후보 없음 — KIS API 장전 데이터 미제공 가능성');
        return;
      }

      // 상위 MAX_PRE_MARKET_WATCH개만 모니터링 (WebSocket 슬롯 보호)
      const watchList = candidates.slice(0, MAX_PRE_MARKET_WATCH);

      this.snapshot840Codes.clear();
      for (const c of candidates) {
        this.snapshot840Codes.set(c.code, { name: c.name, price: c.price, changeRate: c.changeRate });
      }

      // 전일 거래량 조회 (volumeRatio 계산용)
      const codes = watchList.map((c) => c.code);
      this.prevDayVolumeMap = await fetchPrevDayVolumes(codes);

      // WebSocket 구독 시작
      for (const c of watchList) {
        if (!this.watchedCodes.has(c.code)) {
          quantMetricsService.subscribe(c.code, c.name);
          this.watchedCodes.add(c.code);
        }
      }
      this.isWatching = true;

      console.log(
        `[PreMarket] 8:40 완료: 후보 ${candidates.length}개 | 모니터링 시작 ${watchList.length}개` +
        ` | 전일거래량 조회 ${this.prevDayVolumeMap.size}개`
      );
    } catch (err) {
      console.error('[PreMarket] 8:40 실패:', err instanceof Error ? err.message : err);
    }
  }

  // ── 8:50 실행: 재스크리닝 + 8:40 교집합 + WebSocket 상태 검증 ──

  async runAt850(): Promise<void> {
    console.log('[PreMarket] 8:50 KIS 스크리닝 시작');
    try {
      const candidates = await getKisPreMarketCandidates();

      // 8:40과 8:50 양쪽 통과 종목 = 지속적 모멘텀 확인
      // 8:40 데이터 없으면(API 실패 등) 8:50 결과만 사용
      const crossChecked = this.snapshot840Codes.size > 0
        ? candidates.filter((c) => this.snapshot840Codes.has(c.code))
        : candidates.slice(0, MAX_PRE_MARKET_WATCH);

      if (crossChecked.length === 0) {
        console.warn('[PreMarket] 8:50 교집합 없음 — 장전 모멘텀 종목 소멸 또는 API 오류');
        return;
      }

      // 8:50 시점에서 아직 구독 안 된 교집합 종목은 구독 추가
      for (const c of crossChecked) {
        if (!this.watchedCodes.has(c.code)) {
          quantMetricsService.subscribe(c.code, c.name);
          this.watchedCodes.add(c.code);
        }
      }

      const preMarketList: PreMarketStock[] = [];

      for (const c of crossChecked) {
        const state = quantMetricsService.getState(c.code);

        const expectedOpenPrice = state?.currentPrice && state.currentPrice > 0
          ? state.currentPrice
          : c.price;

        const borAtSnapshot = state?.bor        ?? 1.0;
        const borVariance   = state?.borVariance ?? 0;

        // WebSocket에서 수신된 누적 거래량 사용 (없으면 API 값)
        const preMarketVolume = state?.accVolume && state.accVolume > 0
          ? state.accVolume
          : c.volume;

        const prevDayVolume = this.prevDayVolumeMap.get(c.code) ?? 0;
        const volumeRatio   = prevDayVolume > 0 ? preMarketVolume / prevDayVolume : 0;

        preMarketList.push({
          code:              c.code,
          name:              c.name,
          preMarketVolume,
          prevDayVolume,
          volumeRatio,
          expectedOpenPrice,
          borAtSnapshot,
          borVariance,
          isReliable: true, // 8:57 허수 필터에서 최종 판단
          selectedAt:  new Date(),
        });
      }

      this.filteredList = preMarketList;
      console.log(`[PreMarket] 8:50 후보 확정: ${preMarketList.length}개 (8:40 교집합)`);

      for (const s of preMarketList) {
        const ratioStr = s.volumeRatio > 0 ? `VRatio: ${s.volumeRatio.toFixed(2)}x` : 'VRatio: N/A';
        console.log(
          `[PreMarket]   ${s.name}(${s.code})` +
          ` | 예상시가: ${s.expectedOpenPrice.toLocaleString()}원` +
          ` | BOR: ${s.borAtSnapshot.toFixed(2)} | ${ratioStr}`
        );
      }
    } catch (err) {
      console.error('[PreMarket] 8:50 실패:', err instanceof Error ? err.message : err);
    }
  }

  // ── 8:57 실행: BOR 변동성 기반 허수 주문 제거 ──────────────────
  //
  // 8:58~8:59 직전 세력이 대량 주문을 넣었다 빼는 허수 주문 집중 시점.
  // BOR 분산이 높은 종목 = 호가창이 불안정 → 제외

  runAt857(): void {
    console.log('[PreMarket] 8:57 허수 주문 필터링 시작');
    const before = this.filteredList.length;

    this.filteredList = this.filteredList
      .map((stock) => {
        const state = quantMetricsService.getState(stock.code);
        if (!state) return { ...stock, isReliable: false };

        const borVariance = state.borVariance;
        const isReliable  = borVariance < BOR_VARIANCE_THRESHOLD;

        return {
          ...stock,
          borAtSnapshot:     state.bor,
          borVariance,
          expectedOpenPrice: state.currentPrice || stock.expectedOpenPrice,
          isReliable,
        };
      })
      .filter((s) => s.isReliable);

    console.log(
      `[PreMarket] 8:57 허수 필터: ${before}개 → ${this.filteredList.length}개` +
      ` (${before - this.filteredList.length}개 제거)`
    );

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

  // ── 9:00 실행: 장전 WebSocket 구독 해제 → KIS 슬롯 반환 ────────
  // filteredList는 유지 — 엔진이 OPENING/EARLY_MORNING 구간에서 읽음

  clearPreMarketSubscriptions(): void {
    if (!this.isWatching) return;

    let cleared = 0;
    for (const code of this.watchedCodes) {
      quantMetricsService.unsubscribe(code);
      cleared++;
    }
    this.watchedCodes.clear();
    this.snapshot840Codes.clear();
    this.prevDayVolumeMap.clear();
    this.isWatching = false;

    console.log(
      `[PreMarket] 장전 구독 정리 완료 (${cleared}개 해제 → 슬롯 반환)` +
      ` | 필터 목록 ${this.filteredList.length}개 유지 (엔진 인계)`
    );
  }
}

export const preMarketFilterService = new PreMarketFilterService();
