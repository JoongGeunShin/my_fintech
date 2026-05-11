// KIS 주식 분봉 조회 (TR: FHKST03010200)
import axios from 'axios';
import { memCache, TTL } from '../../utils/cache.js';
import { getAccessToken } from './tokenService.js';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export interface MinuteBar {
  date: string;   // YYYYMMDD
  time: string;   // HHmmss
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface KisMinuteChartOutput {
  stck_bsop_date: string;
  stck_cntg_hour: string;
  stck_prpr: string;
  stck_oprc: string;
  stck_hgpr: string;
  stck_lwpr: string;
  cntg_vol: string;
}

interface KisMinuteChartResponse {
  rt_cd: string;
  msg1: string;
  output2: KisMinuteChartOutput[];
}

/**
 * 현재 시각 기준으로 최근 N개 분봉 조회
 */
export async function getMinuteBars(code: string, count = 10): Promise<MinuteBar[]> {
  const cacheKey = `minbars:${code}`;
  const cached = memCache.get<MinuteBar[]>(cacheKey);
  if (cached) return cached;

  const appKey       = process.env.KIS_API_APP_KEY!;
  const appSecretKey = process.env.KIS_API_APP_SECRET_KEY!;
  const accessToken  = await getAccessToken();

  const now = new Date();
  const hour   = now.getHours().toString().padStart(2, '0');
  const minute = now.getMinutes().toString().padStart(2, '0');
  const inputHour = `${hour}${minute}00`;

  const response = await axios.get<KisMinuteChartResponse>(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`,
    {
      params: {
        FID_ETC_CLS_CODE:      '',
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD:        code,
        FID_INPUT_HOUR_1:      inputHour,
        FID_PW_DATA_INCU_YN:   'Y',
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${accessToken}`,
        appkey:         appKey,
        appsecret:      appSecretKey,
        tr_id:          'FHKST03010200',
        custtype:       'P',
      },
      timeout: 5_000,
    }
  );

  const { rt_cd, msg1, output2 } = response.data;
  if (rt_cd !== '0') throw new Error(`KIS 분봉 오류: ${msg1}`);

  const bars: MinuteBar[] = (output2 ?? []).slice(0, count).map((b) => ({
    date:   b.stck_bsop_date,
    time:   b.stck_cntg_hour,
    open:   parseFloat(b.stck_oprc)  || 0,
    high:   parseFloat(b.stck_hgpr)  || 0,
    low:    parseFloat(b.stck_lwpr)  || 0,
    close:  parseFloat(b.stck_prpr)  || 0,
    volume: parseInt(b.cntg_vol, 10) || 0,
  }));

  memCache.set(cacheKey, bars, TTL.FIVE_MINUTES);
  return bars;
}

/**
 * ATR(Average True Range) 계산
 * bars[0] 가 가장 최근
 */
export function calcATR(bars: MinuteBar[], period = 5): number {
  if (bars.length < 2) return 0;

  const trs: number[] = [];
  for (let i = 0; i + 1 < bars.length; i++) {
    const { high, low } = bars[i];
    const prevClose     = bars[i + 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low  - prevClose)
    );
    trs.push(tr);
  }

  const slice = trs.slice(0, period);
  return slice.length > 0 ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
}

/**
 * KIS 계좌 잔고 조회 (실전: TTTC8434R / 모의: VTTC8434R)
 * 향후 실전 연동 시 사용 — 현재는 가상 포트폴리오를 사용
 */
export async function getAccountBalance(): Promise<{ totalEvalAmount: number; availableAmount: number }> {
  const appKey       = process.env.KIS_API_APP_KEY!;
  const appSecretKey = process.env.KIS_API_APP_SECRET_KEY!;
  const accountId    = process.env.KIS_ACCOUNT_ID!;
  const accessToken  = await getAccessToken();

  const [acntNo, acntPrdtCd] = accountId.includes('-')
    ? accountId.split('-')
    : [accountId.slice(0, 8), accountId.slice(8)];

  const response = await axios.get<{
    rt_cd: string;
    msg1: string;
    output2: Array<{ dnca_tot_amt: string; prvs_rcdl_excc_amt: string }>;
  }>(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance`,
    {
      params: {
        CANO:            acntNo,
        ACNT_PRDT_CD:    acntPrdtCd || '01',
        AFHR_FLPR_YN:    'N',
        OFL_YN:          '',
        INQR_DVSN:       '02',
        UNPR_DVSN:       '01',
        FUND_STTL_ICLD_YN: 'N',
        FNCG_AMT_AUTO_RDPT_YN: 'N',
        PRCS_DVSN:       '01',
        CTX_AREA_FK100:  '',
        CTX_AREA_NK100:  '',
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${accessToken}`,
        appkey:         appKey,
        appsecret:      appSecretKey,
        tr_id:          'TTTC8434R',
        custtype:       'P',
      },
      timeout: 5_000,
    }
  );

  const { rt_cd, msg1, output2 } = response.data;
  if (rt_cd !== '0') throw new Error(`KIS 잔고 조회 오류: ${msg1}`);

  const row = output2?.[0];
  return {
    totalEvalAmount:  parseInt(row?.dnca_tot_amt ?? '0', 10),
    availableAmount:  parseInt(row?.prvs_rcdl_excc_amt ?? '0', 10),
  };
}
