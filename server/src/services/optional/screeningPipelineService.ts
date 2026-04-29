import { saveScreeningResults, ScreenedStock } from '../../repositories/screeningRepository.js';
import { memCache, TTL } from '../../utils/cache.js';
import { getOptionalSearchItem } from './optionalSearchItemService.js';
import { getOptionalSearchList } from './optionalSearchListService.js';

const MAIN_GROUP = 'my_fintech';

// ── 조건 카테고리 ─────────────────────────────────────────────
type ConditionCategory = 'REQUIRED' | 'SUPPORT' | 'DETAIL' | 'UNKNOWN';

function getCategory(conditionName: string): ConditionCategory {
  if (conditionName.startsWith('[필수]')) return 'REQUIRED';
  if (conditionName.startsWith('[보조]')) return 'SUPPORT';
  if (conditionName.startsWith('[세부]')) return 'DETAIL';
  return 'UNKNOWN';
}

// ── 조건 정보 (seq + 이름) ───────────────────────────────────
interface ConditionInfo {
  seq: number;
  conditionName: string;
  category: ConditionCategory;
}

export interface ScreeningResult {
  runAt: Date;
  byLevel: Record<number, ScreenedStock[]>; // my_fintech 전용
  byGroup: Record<string, ScreenedStock[]>; // 기타 그룹
  topStocks: ScreenedStock[];               // my_fintech 상위 종목
}

// ── 캐시 키 ─────────────────────────────────────────────────
const CACHE_KEY_SCREENING = 'screening:latest';

// ── 레벨 판정 (my_fintech 전용) ──────────────────────────────
function calcLevel(
  passedSeqs: Set<number>,
  requiredSeqs: number[],
  supportSeqs: number[],
  detailSeqs: number[]
): number {
  const passedAnyRequired =
    requiredSeqs.length === 0 || requiredSeqs.some((s) => passedSeqs.has(s));
  if (!passedAnyRequired) return 0;

  const passedAnySupport =
    supportSeqs.length === 0 || supportSeqs.some((s) => passedSeqs.has(s));
  if (!passedAnySupport) return 1;

  const passedAnyDetail =
    detailSeqs.length === 0 || detailSeqs.some((s) => passedSeqs.has(s));
  if (!passedAnyDetail) return 2;

  return 3;
}

// ─────────────────────────────────────────────────────────────
// 메인 스크리닝 실행
// ─────────────────────────────────────────────────────────────

export async function runFullScreening(): Promise<ScreeningResult> {
  const start = Date.now();
  console.log('[Screening] 전체 조건 검색 시작...');

  // ── 1. 조건 목록 조회 ──────────────────────────────────────
  const listData = await getOptionalSearchList();
  const conditions = listData.optionalSearchList;

  // groupName 별로 분류
  const groupMap = new Map<string, ConditionInfo[]>();
  for (const item of conditions) {
    const seq = parseInt(item.sequence, 10);
    const category = getCategory(item.conditionName);
    const info: ConditionInfo = { seq, conditionName: item.conditionName, category };

    const group = item.groupName ?? 'unknown';
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(info);
  }

  console.log(
    `[Screening] 그룹 분류 → ` +
    [...groupMap.entries()].map(([g, infos]) => `${g}:${infos.length}개`).join(', ')
  );

  // ── 2. 그룹별 종목 수집 ────────────────────────────────────
  // 모든 seq에 대해 API 호출 (그룹 구분 없이 한번에)
  const allSeqs = conditions.map((c) => parseInt(c.sequence, 10));

  // conditionName 빠른 조회용 맵 (seq → ConditionInfo)
  const seqInfoMap = new Map<number, ConditionInfo>();
  for (const [, infos] of groupMap) {
    for (const info of infos) seqInfoMap.set(info.seq, info);
  }

  // code → { passedSeqs: Set<number>, meta }
  const passedSeqsByCode = new Map<string, Set<number>>();
  const stockMeta = new Map<
    string,
    Omit<ScreenedStock, 'passedSequences' | 'passedSequenceInfos' | 'score' | 'updatedAt'>
  >();

  await Promise.allSettled(
    allSeqs.map(async (seq) => {
      try {
        const result = await getOptionalSearchItem(String(seq));
        for (const stock of result.list) {
          const code = stock.code;
          if (!passedSeqsByCode.has(code)) passedSeqsByCode.set(code, new Set());
          passedSeqsByCode.get(code)!.add(seq);

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
        console.log(`[Screening] seq=${seq}(${seqInfoMap.get(seq)?.conditionName}) → ${result.list.length}개`);
      } catch (err) {
        console.warn(`[Screening] seq=${seq} 실패:`, err instanceof Error ? err.message : err);
      }
    })
  );

  // ── 3. my_fintech: 레벨 판정 ──────────────────────────────
  const myFintechInfos = groupMap.get(MAIN_GROUP) ?? [];
  const requiredSeqs = myFintechInfos.filter((i) => i.category === 'REQUIRED').map((i) => i.seq);
  const supportSeqs  = myFintechInfos.filter((i) => i.category === 'SUPPORT').map((i) => i.seq);
  const detailSeqs   = myFintechInfos.filter((i) => i.category === 'DETAIL').map((i) => i.seq);
  const myFintechSeqSet = new Set(myFintechInfos.map((i) => i.seq));

  if (requiredSeqs.length === 0) {
    console.warn('[Screening] [필수] 접두어를 가진 조건이 my_fintech에 없습니다.');
  }

  const resultsByLevel = new Map<number, ScreenedStock[]>();

  for (const [code, passedSeqs] of passedSeqsByCode) {
    // my_fintech seq만 필터링
    const myPassedSeqs = new Set<number>([...passedSeqs].filter((s) => myFintechSeqSet.has(s)));
    if (myPassedSeqs.size === 0) continue;

    const level = calcLevel(myPassedSeqs, requiredSeqs, supportSeqs, detailSeqs);
    if (level === 0) continue;

    const meta = stockMeta.get(code);
    if (!meta) continue;

    // passedSequenceInfos 구성 (요구사항 4: seq + 이름)
    const passedSequenceInfos = [...myPassedSeqs].map((seq) => ({
      seq,
      conditionName: seqInfoMap.get(seq)?.conditionName ?? `seq${seq}`,
    }));

    const stock: ScreenedStock = {
      ...meta,
      passedSequences: [...myPassedSeqs],         // 하위 호환
      passedSequenceInfos,                         // 이름 포함 (신규)
      score: level,
      updatedAt: new Date() as unknown as import('firebase-admin/firestore').Timestamp,
    };

    if (!resultsByLevel.has(level)) resultsByLevel.set(level, []);
    resultsByLevel.get(level)!.push(stock);
  }

  // ── 4. 기타 그룹: 통과한 종목 단순 수집 ────────────────────
  const byGroup: Record<string, ScreenedStock[]> = {};
  const otherGroups = [...groupMap.keys()].filter((g) => g !== MAIN_GROUP);

  for (const groupName of otherGroups) {
    const groupInfos   = groupMap.get(groupName)!;
    const groupSeqSet  = new Set(groupInfos.map((i) => i.seq));
    const groupStocks: ScreenedStock[] = [];

    for (const [code, passedSeqs] of passedSeqsByCode) {
      const groupPassedSeqs = new Set<number>([...passedSeqs].filter((s) => groupSeqSet.has(s)));
      if (groupPassedSeqs.size === 0) continue;

      const meta = stockMeta.get(code);
      if (!meta) continue;

      const passedSequenceInfos = [...groupPassedSeqs].map((seq) => ({
        seq,
        conditionName: seqInfoMap.get(seq)?.conditionName ?? `seq${seq}`,
      }));

      groupStocks.push({
        ...meta,
        passedSequences: [...groupPassedSeqs],
        passedSequenceInfos,
        score: groupPassedSeqs.size, // 기타 그룹은 통과 조건 수를 score로 사용
        updatedAt: new Date() as unknown as import('firebase-admin/firestore').Timestamp,
      });
    }

    byGroup[groupName] = groupStocks.sort(
      (a, b) => b.passedSequences.length - a.passedSequences.length
    );
  }

  // ── 5. Firebase 저장 ────────────────────────────────────────
  const durationMs = Date.now() - start;

  // my_fintech 저장
  try {
    await saveScreeningResults(MAIN_GROUP, resultsByLevel, [], durationMs);
  } catch (err) {
    console.error('[Screening] Firebase my_fintech 저장 실패:', err);
  }

  // 기타 그룹 저장
  for (const [groupName, stocks] of Object.entries(byGroup)) {
    try {
      await saveScreeningResults(groupName, new Map(), stocks, durationMs);
    } catch (err) {
      console.error(`[Screening] Firebase ${groupName} 저장 실패:`, err);
    }
  }

  // ── 6. 결과 조합 ────────────────────────────────────────────
  const byLevel: Record<number, ScreenedStock[]> = {};
  for (const [lvl, stocks] of resultsByLevel) {
    byLevel[lvl] = stocks.sort(
      (a, b) => b.passedSequences.length - a.passedSequences.length
    );
  }

  const topStocks = [...resultsByLevel.entries()]
    .flatMap(([, stocks]) => stocks)
    .sort((a, b) => b.score - a.score || b.passedSequences.length - a.passedSequences.length);

  const screeningResult: ScreeningResult = {
    runAt: new Date(),
    byLevel,
    byGroup,
    topStocks,
  };

  memCache.set(CACHE_KEY_SCREENING, screeningResult, TTL.FIVE_MINUTES);

  console.log(
    `[Screening] 완료: ${durationMs}ms | ` +
    Object.entries(byLevel).map(([lvl, s]) => `level${lvl}:${s.length}개`).join(' | ') +
    (otherGroups.length > 0
      ? ' | ' + otherGroups.map((g) => `${g}:${byGroup[g]?.length ?? 0}개`).join(' | ')
      : '')
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