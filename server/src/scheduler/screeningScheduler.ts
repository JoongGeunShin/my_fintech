import { runFullScreening } from '../services/optional/screeningPipelineService.js';
import { preMarketFilterService } from '../services/optional/preMarketFilterService.js';
import { broadcastScreeningUpdate } from '../socket/socketServer.js';

const INTERVAL_MS = 5 * 60 * 1000; // 5분

let timer:     ReturnType<typeof setInterval> | null = null;
let isRunning  = false;
const preMarketTimers: ReturnType<typeof setTimeout>[] = [];

// ── 장중 5분 스케줄러 ─────────────────────────────────────────

export function startScreeningScheduler(): void {
  if (timer) {
    console.warn('[Scheduler] 이미 실행 중입니다.');
    return;
  }

  console.log('[Scheduler] 조건 검색 스케줄러 시작 (5분 간격)');
  _runSafe();
  timer = setInterval(_runSafe, INTERVAL_MS);
}

export function stopScreeningScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Scheduler] 스케줄러 정지');
  }
  for (const t of preMarketTimers) clearTimeout(t);
  preMarketTimers.length = 0;
}

// ── 장전 동시호가 타임 스케줄러 ───────────────────────────────
//
// KOSPI 동시호가 타임: 8:00~9:00
//
// 최적 체크 시점:
//   8:40 — 1차 후보군 확보 (너무 이르지 않은 시점, 의미 있는 거래량 형성됨)
//   8:50 — 메인 스크리닝 (가장 신뢰도 높음 — 8:58 이후 허수 주문 급증 전)
//   8:57 — 허수 주문 필터 (8:58~8:59 직전 BOR 변동성 기반 최종 걸러내기)
//
// 왜 8:58~8:59는 안되나?
//   직전 1~2분에 세력이 의도적으로 대량 주문을 넣었다 빼며 시가를 조작하려는
//   "허수 주문(ghost order)"이 집중됨. 이 시점 데이터는 신뢰도가 낮음.
//
// efriend 조건검색 설정 가이드:
//   - 그룹명: "장전필터" 로 새 그룹 생성
//   - 조건1: [필수] 장전시간외거래량비율 >= 200
//            (장전 누적 거래량 / 전일 거래량 × 100 >= 200)
//   - 조건2: [보조] 시가총액 >= 200억 (소형주 유동성 리스크 제거)
//   - 조건3: [보조] 전일종가 >= 2000 (저가주 제외)
//   이 그룹이 기존 screeningPipelineService의 byGroup에 자동 수집됨

export function schedulePreMarketRuns(): void {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const targets: Array<{ label: string; hh: number; mm: number; fn: () => void }> = [
    {
      label: '8:40',
      hh: 8, mm: 40,
      fn: () => preMarketFilterService.runAt840().catch(console.error),
    },
    {
      label: '8:50',
      hh: 8, mm: 50,
      fn: () => preMarketFilterService.runAt850().catch(console.error),
    },
    {
      label: '8:57',
      hh: 8, mm: 57,
      fn: () => preMarketFilterService.runAt857(),
    },
  ];

  for (const target of targets) {
    const fireAt = new Date(today);
    fireAt.setHours(target.hh, target.mm, 0, 0);

    const delay = fireAt.getTime() - Date.now();
    if (delay < 0) {
      console.log(`[PreMarket] ${target.label} 이미 지남 → 스킵`);
      continue;
    }

    const t = setTimeout(() => {
      console.log(`[PreMarket] ${target.label} 실행`);
      target.fn();
    }, delay);

    preMarketTimers.push(t);
    console.log(`[PreMarket] ${target.label} 예약 완료 (${Math.round(delay / 1000)}초 후)`);
  }
}

async function _runSafe(): Promise<void> {
  if (isRunning) {
    console.warn('[Scheduler] 이전 실행이 아직 진행 중 → 스킵');
    return;
  }

  isRunning = true;
  try {
    const result = await runFullScreening();
    broadcastScreeningUpdate(result);
  } catch (err) {
    console.error('[Scheduler] 스크리닝 실패:', err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}
