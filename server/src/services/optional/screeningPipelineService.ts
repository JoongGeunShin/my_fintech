import { saveScreeningResults, ScreenedStock } from '../../repositories/screeningRepository.js';
import { memCache, TTL } from '../../utils/cache.js';
import { getOptionalSearchItem } from './optionalSearchItemService.js';
import { getOptionalSearchList } from './optionalSearchListService.js';

const CACHE_KEY_SCREENING = 'screening:latest';

// ── 조건 카테고리 ─────────────────────────────────────────
type ConditionCategory = 'REQUIRED' | 'SUPPORT' | 'DETAIL' | 'UNKNOWN';

/**
 * conditionName 접두어로 카테고리 분류
 * [필수] → REQUIRED, [보조] → SUPPORT, [세부] → DETAIL
 */
function getCategory(conditionName: string): ConditionCategory {
  if (conditionName.startsWith('[필수]')) return 'REQUIRED';
  if (conditionName.startsWith('[보조]')) return 'SUPPORT';
  if (conditionName.startsWith('[세부]')) return 'DETAIL';
  return 'UNKNOWN';
}

export interface ScreeningResult {
  runAt: Date;
  byLevel: Record<number, ScreenedStock[]>;
  topStocks: ScreenedStock[]; // score 높은 순 전체
}

/**
 * 레벨 판정 로직
 *
 * level1: 필수 조건 전부 통과
 * level2: level1 + 보조 조건 전부 통과
 * level3: level2 + 세부 조건 하나라도 통과
 *
 * 조건을 만족하지 못하면 level0 (미편입)
 */
function calcLevel(
  passedSeqs: Set<number>,
  requiredSeqs: number[],
  supportSeqs: number[],
  detailSeqs: number[]
): number {
  // 필수 하나라도 통과?
  const passedAnyRequired =
    requiredSeqs.length === 0 || requiredSeqs.some((s) => passedSeqs.has(s));
  if (!passedAnyRequired) return 0;

  // 보조 하나라도 통과?
  const passedAnySupport =
    supportSeqs.length === 0 || supportSeqs.some((s) => passedSeqs.has(s));
  if (!passedAnySupport) return 1;

  // 세부 하나라도 통과?
  const passedAnyDetail =
    detailSeqs.length === 0 || detailSeqs.some((s) => passedSeqs.has(s));
  if (!passedAnyDetail) return 2;

  return 3;
}

export async function runFullScreening(): Promise<ScreeningResult> {
  const start = Date.now();
  console.log('[Screening] 전체 조건 검색 시작...');

  // ── 1. 조건 목록 조회 ──────────────────────────────────
  const listData = await getOptionalSearchList();
  const conditions = listData.optionalSearchList;

  // sequence 별 카테고리 매핑
  const seqCategoryMap = new Map<number, ConditionCategory>();
  const requiredSeqs: number[] = [];
  const supportSeqs: number[] = [];
  const detailSeqs: number[] = [];

  for (const item of conditions) {
    const seq = parseInt(item.sequence, 10);
    const category = getCategory(item.conditionName);
    seqCategoryMap.set(seq, category);

    if (category === 'REQUIRED') requiredSeqs.push(seq);
    else if (category === 'SUPPORT') supportSeqs.push(seq);
    else if (category === 'DETAIL') detailSeqs.push(seq);
  }

  console.log(
    `[Screening] 조건 분류 → 필수:${requiredSeqs.length} 보조:${supportSeqs.length} 세부:${detailSeqs.length}`
  );

  // 필수 조건이 하나도 없으면 실행 의미 없음
  if (requiredSeqs.length === 0) {
    console.warn('[Screening] [필수] 접두어를 가진 조건이 없습니다. 조건명을 확인해주세요.');
  }

  // ── 2. 각 조건별 종목 수집 ─────────────────────────────
  const allSeqs = [...seqCategoryMap.keys()];
  // code → 통과한 seq Set
  const passedSeqsByCodeStr = new Map<string, Set<number>>();
  const stockMeta = new Map<
    string,
    Omit<ScreenedStock, 'passedSequences' | 'score' | 'level' | 'updatedAt'>
  >();

  await Promise.allSettled(
    allSeqs.map(async (seq) => {
      try {
        const result = await getOptionalSearchItem(String(seq));
        for (const stock of result.list) {
          const code = stock.code;
          if (!passedSeqsByCodeStr.has(code)) {
            passedSeqsByCodeStr.set(code, new Set());
          }
          passedSeqsByCodeStr.get(code)!.add(seq);

          if (!stockMeta.has(code)) {
            stockMeta.set(code, {
              code,
              name: stock.name,
              price: stock.price,
              changeRate: stock.chnageRate,
              tradeVolume: stock.tradeVolume,
              tradeAmount: stock.tradeAmount,
              high52Price: stock.high52Price,
              low52Price: stock.low52Price,
            });
          }
        }
        console.log(`[Screening] seq=${seq}(${seqCategoryMap.get(seq)}) → ${result.list.length}개`);
      } catch (err) {
        console.warn(`[Screening] seq=${seq} 실패:`, err instanceof Error ? err.message : err);
      }
    })
  );

  // ── 3. 레벨 판정 ──────────────────────────────────────
  const resultsByLevel = new Map<number, ScreenedStock[]>();

  for (const [code, passedSeqs] of passedSeqsByCodeStr) {
    const level = calcLevel(passedSeqs, requiredSeqs, supportSeqs, detailSeqs);
    if (level === 0) continue; // 필수 미통과 → 제외

    const meta = stockMeta.get(code);
    if (!meta) continue;

    const stock: ScreenedStock = {
      ...meta,
      passedSequences: [...passedSeqs],
      score: level,
      updatedAt: new Date() as unknown as import('firebase-admin/firestore').Timestamp,
    };

    if (!resultsByLevel.has(level)) resultsByLevel.set(level, []);
    resultsByLevel.get(level)!.push(stock);
  }

  // ── 4. Firebase 저장 ──────────────────────────────────
  const durationMs = Date.now() - start;
  try {
    await saveScreeningResults(resultsByLevel, durationMs);
  } catch (err) {
    console.error('[Screening] Firebase 저장 실패:', err);
  }

  // ── 5. 결과 조합 ──────────────────────────────────────
  const byLevel: Record<number, ScreenedStock[]> = {};
  for (const [lvl, stocks] of resultsByLevel) {
    // 같은 레벨 안에서는 통과한 조건 수가 많은 순으로 정렬
    byLevel[lvl] = stocks.sort((a, b) => b.passedSequences.length - a.passedSequences.length);
  }

  // topStocks: level 높은 순 → 통과 조건 수 많은 순
  const topStocks = [...resultsByLevel.entries()]
    .flatMap(([, stocks]) => stocks)
    .sort((a, b) => b.score - a.score || b.passedSequences.length - a.passedSequences.length);

  const screeningResult: ScreeningResult = {
    runAt: new Date(),
    byLevel,
    topStocks,
  };

  memCache.set(CACHE_KEY_SCREENING, screeningResult, TTL.FIVE_MINUTES);
  console.log(
    `[Screening] 완료: ${durationMs}ms | ` +
    Object.entries(byLevel)
      .map(([lvl, s]) => `level${lvl}:${s.length}개`)
      .join(' | ')
  );

  return screeningResult;
}

export async function getScreeningResult(): Promise<ScreeningResult> {
  const cached = memCache.get<ScreeningResult>(CACHE_KEY_SCREENING);
  if (cached) {
    console.log('[Screening] 캐시 히트');
    return cached;
  }
  return runFullScreening();
}