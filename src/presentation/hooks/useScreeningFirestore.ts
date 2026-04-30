import { collection, limit, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { db } from '../../data/sources/firebase';

export interface ScreenedStockClient {
  code: string;
  name: string;
  price: string;
  changeRate: string;
  tradeVolume: string;
  tradeAmount: string;
  high52Price: string;
  low52Price: string;
  passedSequences: number[];
  passedSequenceInfos?: { seq: number; conditionName: string }[];
  score: number;
  updatedAt?: Timestamp;
}

/** "00000001500.0000" 형식 → 1500 */
export function parsePrice(raw: string): number {
  return parseFloat(raw) || 0;
}

const COL_LEVEL  = (level: number) => `screenedLevel${level}`;
const COL_GROUP  = (groupName: string) => `screened_${groupName}`;
const COL_RUNS   = 'screeningRuns';
const MAIN_GROUP = 'my_fintech';
const MIN_LEVEL  = 2;
const MAX_LEVEL  = 3;

// 항상 직접 구독할 추가 그룹 (screened_조건 등)
const KNOWN_EXTRA_GROUPS: readonly string[] = ['조건'];

function subscribeGroup(
  groupName: string,
  setOtherGroups: React.Dispatch<React.SetStateAction<Record<string, ScreenedStockClient[]>>>
): () => void {
  const q = query(collection(db, COL_GROUP(groupName)), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const stocks: ScreenedStockClient[] = snap.docs
        .map((d) => d.data() as ScreenedStockClient)
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.passedSequences.length - a.passedSequences.length
        );
      setOtherGroups((prev) => ({ ...prev, [groupName]: stocks }));
    },
    (err) => {
      console.error(`[Firestore] group(${groupName}) 오류:`, err.message);
    }
  );
}

export function useScreeningFirestore() {
  const [byLevel, setByLevel]         = useState<Record<number, ScreenedStockClient[]>>({});
  const [otherGroups, setOtherGroups] = useState<Record<string, ScreenedStockClient[]>>({});
  // level 2 + level 3 만 로딩 대기 (추가 그룹은 백그라운드 로드)
  const [loadingCount, setLoadingCount] = useState(MAX_LEVEL - MIN_LEVEL + 1);
  const [error, setError]             = useState<string | null>(null);

  const groupUnsubs = useRef<Map<string, () => void>>(new Map());
  const knownGroups = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // ── level 2, 3 구독 ──────────────────────────────────────
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
      const lv = level;
      const q  = query(collection(db, COL_LEVEL(lv)), limit(200));
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const stocks: ScreenedStockClient[] = snapshot.docs
            .map((doc) => doc.data() as ScreenedStockClient)
            .sort(
              (a, b) =>
                b.passedSequences.length - a.passedSequences.length ||
                a.name.localeCompare(b.name, 'ko')
            );
          setByLevel((prev) => ({ ...prev, [lv]: stocks }));
          setLoadingCount((c) => Math.max(0, c - 1));
        },
        (err) => {
          console.error(`[Firestore] level${lv} 오류:`, err.code, err.message);
          setError(`Firestore 오류 (level${lv}): ${err.message}`);
          setLoadingCount((c) => Math.max(0, c - 1));
        }
      );
      unsubs.push(unsub);
    }

    // ── 고정 추가 그룹 직접 구독 ────────────────────────────
    for (const groupName of KNOWN_EXTRA_GROUPS) {
      if (knownGroups.current.has(groupName)) continue;
      knownGroups.current.add(groupName);
      const unsub = subscribeGroup(groupName, setOtherGroups);
      groupUnsubs.current.set(groupName, unsub);
    }

    // ── screeningRuns → 추가 그룹 동적 탐색 ─────────────────
    const runsUnsub = onSnapshot(
      query(collection(db, COL_RUNS), limit(200)),
      (snapshot) => {
        for (const doc of snapshot.docs) {
          const groupName = doc.data().groupName as string | undefined;
          if (
            !groupName ||
            groupName === MAIN_GROUP ||
            knownGroups.current.has(groupName)
          ) continue;

          knownGroups.current.add(groupName);
          const unsub = subscribeGroup(groupName, setOtherGroups);
          groupUnsubs.current.set(groupName, unsub);
        }
      },
      (err) => {
        console.error('[Firestore] screeningRuns 탐색 오류:', err.message);
      }
    );
    unsubs.push(runsUnsub);

    return () => {
      unsubs.forEach((u) => u());
      groupUnsubs.current.forEach((u) => u());
      groupUnsubs.current.clear();
      knownGroups.current.clear();
    };
  }, []);

  const seen = new Set<string>();
  const topStocks = [3, 2]
    .flatMap((lv) => byLevel[lv] ?? [])
    .filter((s) => {
      if (seen.has(s.code)) return false;
      seen.add(s.code);
      return true;
    });

  return {
    byLevel,
    topStocks,
    otherGroups,
    isLoading: loadingCount > 0,
    error,
  };
}
