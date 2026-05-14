// KIS API 기반 실시간 모멘텀 스크리닝
// 거래량 순위 + 등락률 순위 두 API를 병렬 조회 후 교집합 우선 정렬
import axios from 'axios';
import { getAccessToken } from './tokenService.js';

const KIS_BASE_URL = process.env.KIS_BASE_URL ?? 'https://openapi.koreainvestment.com:9443';

// ── 필터 상수 (보수적 리스크 기준) ────────────────────────────
const CANDIDATE_POOL      = 50;             // 각 순위 API 상위 N개에서 필터링
const MIN_PRICE           = 3_000;          // 동전주 제외
const MAX_PRICE           = 100_000;        // 50만원 계좌 기준 최소 5주 가능
const MIN_DAILY_TURNOVER  = 3_000_000_000;  // 30억원 이상 (유동성 확보)
const MAX_CHANGE_RATE     = 20;             // +20% 초과 = 상한가 근처, 이미 완료
const MIN_CHANGE_RATE     = -8;             // -8% 미만 = 급락 중, 추가 하락 위험
const MAX_GAP_FROM_OPEN   = 8;             // 시가 대비 +8% 초과 = 이미 급등 완료

// 등락률 순위 전용: 모멘텀 최소 기준 (단순 변동 제외, 실질 상승만)
const RATE_MIN_CHANGE_RATE = 1.5; // +1.5% 미만이면 모멘텀으로 보지 않음

// 이름 기반 제외 (ETF·인버스·스팩 등 — API 파라미터 한계 보완)
const EXCLUDE_KEYWORDS = [
  'ETF', '인버스', '레버리지', '리츠', 'REIT', 'SPAC', '스팩',
  'TDF', 'MMF', '선물', '우', 'B', // 우선주·B주 (유동성 낮음)
];

// 정상 종목 상태 코드 (00=정상)
// 51=관리종목, 52=투자경고, 53=투자위험, 54=투자주의, 55=신용경고
const NORMAL_STAT_CODE = '00';

// ── 공통 API 응답 행 타입 ─────────────────────────────────────
type RankingRow = {
  mksc_shrn_iscd:     string;
  hts_kor_isnm:       string;
  stck_prpr:          string;
  prdy_ctrt:          string;
  acml_vol:           string;
  acml_tr_pbmn:       string;
  stck_oprc:          string;
  iscd_stat_cls_code: string;
};

export interface KisScreenedStock {
  code:       string;
  name:       string;
  price:      number;
  changeRate: number; // 전일 대비율 (%)
  turnover:   number; // 누적 거래대금 (원)
  volume:     number; // 누적 거래량
  source:     'volume' | 'rate' | 'both'; // 스크리닝 출처
}

// ── 메인: 거래량 순위 + 등락률 순위 병렬 조회 → 교집합 우선 정렬 ──
// 교집합 = 거래량도 많고 오르고 있는 종목 → 가장 신뢰도 높음

export async function getKisScreenedStocks(): Promise<KisScreenedStock[]> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error('[KisScreening] 토큰 발급 실패:', err instanceof Error ? err.message : err);
    return [];
  }

  const [volumeStocks, rateStocks] = await Promise.all([
    _fetchVolumeRanking(token),
    _fetchRateRanking(token),
  ]);

  const rateCodes   = new Set(rateStocks.map((s) => s.code));
  const volumeCodes = new Set(volumeStocks.map((s) => s.code));

  const merged: KisScreenedStock[] = [];

  // 1순위: 두 순위 모두 진입 (거래량 + 모멘텀 동시 확인)
  for (const s of volumeStocks) {
    if (rateCodes.has(s.code)) merged.push({ ...s, source: 'both' });
  }

  // 2순위: 거래량 순위만 (유동성 충분, 모멘텀은 약함)
  for (const s of volumeStocks) {
    if (!rateCodes.has(s.code)) merged.push({ ...s, source: 'volume' });
  }

  // 3순위: 등락률 순위만 (오르고 있지만 아직 거래량 순위권 밖)
  for (const s of rateStocks) {
    if (!volumeCodes.has(s.code)) merged.push({ ...s, source: 'rate' });
  }

  const bothCount = merged.filter((s) => s.source === 'both').length;
  console.log(
    `[KisScreening] 거래량 ${volumeStocks.length}개 + 등락률 ${rateStocks.length}개` +
    ` → 교집합 ${bothCount}개 | 최종 ${merged.length}개`
  );

  return merged;
}

// ── 거래량 순위 조회 (FHPST01710000) ──────────────────────────

async function _fetchVolumeRanking(token: string): Promise<KisScreenedStock[]> {
  try {
    const res = await axios.get<{ rt_cd: string; msg1: string; output: RankingRow[] }>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/volume`,
      {
        params: {
          FID_COND_MRKT_DIV_CODE:  'J',
          FID_COND_SCR_DIV_CODE:   '20171',
          FID_INPUT_ISCD:          '0000',
          FID_DIV_CLS_CODE:        '0',       // 전체 (상승+보합+하락)
          FID_BLNG_CLS_CODE:       '0',
          FID_TRGT_CLS_CODE:       '111111111',
          FID_TRGT_EXLS_CLS_CODE:  '000000000',
          FID_INPUT_PRICE_1:       String(MIN_PRICE),
          FID_INPUT_PRICE_2:       String(MAX_PRICE),
          FID_VOL_CNT:             '',
          FID_INPUT_DATE_1:        '',
        },
        headers: _makeHeaders(token, 'FHPST01710000'),
        timeout: 5_000,
      }
    );

    if (res.data.rt_cd !== '0') {
      console.warn(`[KisScreening/Volume] API 오류: ${res.data.msg1}`);
      return [];
    }

    return _parseRanking(res.data.output ?? [], 'volume', {
      minChangeRate: MIN_CHANGE_RATE,
      requireTurnover: true,
    });
  } catch (err) {
    console.error('[KisScreening/Volume] 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ── 등락률 순위 조회 (FHPST01700000) ──────────────────────────
// 주의: TR ID·파라미터는 KIS 개발자 포털에서 최신 스펙 확인 권장
// 응답 오류 시 []를 반환해 거래량 순위만으로 폴백됨

async function _fetchRateRanking(token: string): Promise<KisScreenedStock[]> {
  try {
    const res = await axios.get<{ rt_cd: string; msg1: string; output: RankingRow[] }>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation`,
      {
        params: {
          FID_COND_MRKT_DIV_CODE:  'J',
          FID_COND_SCR_DIV_CODE:   '20170',
          FID_INPUT_ISCD:          '0000',
          FID_DIV_CLS_CODE:        '1',       // 상승 종목만
          FID_BLNG_CLS_CODE:       '0',
          FID_TRGT_CLS_CODE:       '111111111',
          FID_TRGT_EXLS_CLS_CODE:  '000000000',
          FID_INPUT_PRICE_1:       String(MIN_PRICE),
          FID_INPUT_PRICE_2:       String(MAX_PRICE),
          FID_RANK_SORT_CLS_CODE:  '0',       // 상승률 높은 순
          FID_INPUT_DATE_1:        '',
        },
        headers: _makeHeaders(token, 'FHPST01700000'),
        timeout: 5_000,
      }
    );

    if (res.data.rt_cd !== '0') {
      console.warn(`[KisScreening/Rate] API 오류: ${res.data.msg1}`);
      return [];
    }

    return _parseRanking(res.data.output ?? [], 'rate', {
      minChangeRate: RATE_MIN_CHANGE_RATE, // 등락률 순위는 최소 +1.5% 이상만
      requireTurnover: false,              // 거래대금 필터 없음 (막 오르기 시작한 종목 포함)
    });
  } catch (err) {
    console.error('[KisScreening/Rate] 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ── 공통 파싱 + 필터 ──────────────────────────────────────────

function _parseRanking(
  rows: RankingRow[],
  source: 'volume' | 'rate',
  opts: { minChangeRate: number; requireTurnover: boolean }
): KisScreenedStock[] {
  const pool   = rows.slice(0, CANDIDATE_POOL);
  const result: KisScreenedStock[] = [];

  for (const r of pool) {
    const price      = parseInt(r.stck_prpr, 10);
    const changeRate = parseFloat(r.prdy_ctrt);
    const turnover   = parseInt(r.acml_tr_pbmn, 10);
    const volume     = parseInt(r.acml_vol, 10);
    const openPrice  = parseInt(r.stck_oprc, 10);
    const name       = r.hts_kor_isnm.trim();
    const statCode   = r.iscd_stat_cls_code?.trim() ?? NORMAL_STAT_CODE;

    if (!_passFilters({ price, changeRate, turnover, openPrice, name, statCode }, opts)) continue;

    result.push({ code: r.mksc_shrn_iscd, name, price, changeRate, turnover, volume, source });
  }

  return result;
}

function _passFilters(
  s: { price: number; changeRate: number; turnover: number; openPrice: number; name: string; statCode: string },
  opts: { minChangeRate: number; requireTurnover: boolean }
): boolean {
  if (s.price < MIN_PRICE || s.price > MAX_PRICE)               return false;
  if (opts.requireTurnover && s.turnover < MIN_DAILY_TURNOVER)  return false;
  if (s.changeRate > MAX_CHANGE_RATE || s.changeRate < opts.minChangeRate) return false;

  if (s.openPrice > 0) {
    const gapRate = ((s.price - s.openPrice) / s.openPrice) * 100;
    if (gapRate > MAX_GAP_FROM_OPEN) return false;
  }

  if (s.statCode && s.statCode !== NORMAL_STAT_CODE) return false;
  if (EXCLUDE_KEYWORDS.some((kw) => s.name.includes(kw))) return false;

  return true;
}

function _makeHeaders(token: string, trId: string) {
  return {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`,
    appkey:         process.env.KIS_API_APP_KEY!,
    appsecret:      process.env.KIS_API_APP_SECRET_KEY!,
    tr_id:          trId,
    custtype:       'P',
  };
}

// ── 장전 동시호가 후보 조회 ────────────────────────────────────
// FHPST01710000 거래량 순위를 사용하되 장전 특성에 맞게 필터 완화
// (거래대금 필터 없음 — 장전에는 절대 거래대금이 낮음)
// (갭-from-open 필터 없음 — 시가 아직 미형성)

const PM_CANDIDATE_POOL  = 30;
const PM_MIN_CHANGE_RATE = 0.5;
const PM_MAX_CHANGE_RATE = 15;

export interface KisPreMarketCandidate {
  code:       string;
  name:       string;
  price:      number;
  changeRate: number;
  volume:     number;
}

export async function getKisPreMarketCandidates(): Promise<KisPreMarketCandidate[]> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error('[KisPreMarket] 토큰 발급 실패:', err instanceof Error ? err.message : err);
    return [];
  }

  try {
    const res = await axios.get<{ rt_cd: string; msg1: string; output: RankingRow[] }>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/volume`,
      {
        params: {
          FID_COND_MRKT_DIV_CODE:  'J',
          FID_COND_SCR_DIV_CODE:   '20171',
          FID_INPUT_ISCD:          '0000',
          FID_DIV_CLS_CODE:        '0',
          FID_BLNG_CLS_CODE:       '0',
          FID_TRGT_CLS_CODE:       '111111111',
          FID_TRGT_EXLS_CLS_CODE:  '000000000',
          FID_INPUT_PRICE_1:       String(MIN_PRICE),
          FID_INPUT_PRICE_2:       String(MAX_PRICE),
          FID_VOL_CNT:             '',
          FID_INPUT_DATE_1:        '',
        },
        headers: _makeHeaders(token, 'FHPST01710000'),
        timeout: 5_000,
      }
    );

    if (res.data.rt_cd !== '0') {
      console.warn(`[KisPreMarket] API 오류: ${res.data.msg1}`);
      return [];
    }

    const pool   = (res.data.output ?? []).slice(0, PM_CANDIDATE_POOL);
    const result: KisPreMarketCandidate[] = [];

    for (const r of pool) {
      const price      = parseInt(r.stck_prpr, 10);
      const changeRate = parseFloat(r.prdy_ctrt);
      const volume     = parseInt(r.acml_vol, 10);
      const name       = r.hts_kor_isnm.trim();
      const statCode   = r.iscd_stat_cls_code?.trim() ?? NORMAL_STAT_CODE;

      if (price < MIN_PRICE || price > MAX_PRICE)                                continue;
      if (changeRate < PM_MIN_CHANGE_RATE || changeRate > PM_MAX_CHANGE_RATE)   continue;
      if (statCode && statCode !== NORMAL_STAT_CODE)                             continue;
      if (EXCLUDE_KEYWORDS.some((kw) => name.includes(kw)))                     continue;

      result.push({ code: r.mksc_shrn_iscd, name, price, changeRate, volume });
    }

    console.log(`[KisPreMarket] 상위 ${pool.length}개 조회 → 필터 통과 ${result.length}개`);
    return result;
  } catch (err) {
    console.error('[KisPreMarket] 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ── 전일 거래량 일괄 조회 (FHKST01010100) ─────────────────────

export async function fetchPrevDayVolumes(codes: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (codes.length === 0) return map;

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return map;
  }

  await Promise.all(
    codes.map(async (code) => {
      try {
        const res = await axios.get<{ rt_cd: string; output: { prdy_vol: string } }>(
          `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`,
          {
            params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code },
            headers: _makeHeaders(token, 'FHKST01010100'),
            timeout: 5_000,
          }
        );
        if (res.data.rt_cd === '0') {
          map.set(code, parseInt(res.data.output?.prdy_vol ?? '0', 10));
        }
      } catch {
        map.set(code, 0);
      }
    })
  );

  return map;
}
