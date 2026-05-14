// KIS 실전 주문 서비스 (현금 매수/매도 + 잔고/포지션 조회)
import axios from 'axios';
import { getAccessToken } from './tokenService.js';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

function getEnv() {
  return {
    appKey:    process.env.KIS_API_APP_KEY!,
    appSecret: process.env.KIS_API_APP_SECRET_KEY!,
    accountId: process.env.KIS_ACCOUNT_NUMBER!,
  };
}

function splitAccountId(accountId: string): [string, string] {
  return accountId.includes('-')
    ? (accountId.split('-') as [string, string])
    : [accountId.slice(0, 8), accountId.slice(8)];
}

async function makeHeaders(trId: string) {
  const { appKey, appSecret } = getEnv();
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`,
    appkey:         appKey,
    appsecret:      appSecret,
    tr_id:          trId,
    custtype:       'P',
  };
}

// ── 주문 결과 ──────────────────────────────────────────────────

export interface OrderResult {
  success:   boolean;
  orderId:   string;  // KIS 주문번호 (ODNO)
  orderTime: string;  // 주문시각 (HHmmss)
  errorMsg?: string;
}

// ── 현금 매수 주문 (시장가) ────────────────────────────────────
// TR: TTTC0802U
// ORD_DVSN 01=시장가 (체결 지연 없이 즉시 체결, 가격 위험 있으나 초단타에 적합)

export async function placeBuyOrder(code: string, quantity: number): Promise<OrderResult> {
  const { appKey, appSecret, accountId } = getEnv();
  const [cano, acntPrdtCd] = splitAccountId(accountId);
  const token = await getAccessToken();

  try {
    const res = await axios.post<{
      rt_cd: string;
      msg1: string;
      output: { ODNO: string; ORD_TMD: string };
    }>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/order-cash`,
      {
        CANO:         cano,
        ACNT_PRDT_CD: acntPrdtCd || '01',
        PDNO:         code,
        ORD_DVSN:     '01',  // 시장가
        ORD_QTY:      String(quantity),
        ORD_UNPR:     '0',   // 시장가는 0
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
          appkey:         appKey,
          appsecret:      appSecret,
          tr_id:          'TTTC0802U',
          custtype:       'P',
        },
        timeout: 5_000,
      }
    );

    const { rt_cd, msg1, output } = res.data;
    if (rt_cd !== '0') {
      return { success: false, orderId: '', orderTime: '', errorMsg: msg1 };
    }
    return { success: true, orderId: output.ODNO, orderTime: output.ORD_TMD };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, orderId: '', orderTime: '', errorMsg: msg };
  }
}

// ── 현금 매도 주문 (시장가) ────────────────────────────────────
// TR: TTTC0801U

export async function placeSellOrder(code: string, quantity: number): Promise<OrderResult> {
  const { appKey, appSecret, accountId } = getEnv();
  const [cano, acntPrdtCd] = splitAccountId(accountId);
  const token = await getAccessToken();

  try {
    const res = await axios.post<{
      rt_cd: string;
      msg1: string;
      output: { ODNO: string; ORD_TMD: string };
    }>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/order-cash`,
      {
        CANO:         cano,
        ACNT_PRDT_CD: acntPrdtCd || '01',
        PDNO:         code,
        ORD_DVSN:     '01',  // 시장가
        ORD_QTY:      String(quantity),
        ORD_UNPR:     '0',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
          appkey:         appKey,
          appsecret:      appSecret,
          tr_id:          'TTTC0801U',
          custtype:       'P',
        },
        timeout: 5_000,
      }
    );

    const { rt_cd, msg1, output } = res.data;
    if (rt_cd !== '0') {
      return { success: false, orderId: '', orderTime: '', errorMsg: msg1 };
    }
    return { success: true, orderId: output.ODNO, orderTime: output.ORD_TMD };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, orderId: '', orderTime: '', errorMsg: msg };
  }
}

// ── 주문가능금액 조회 (미수금 방지 핵심) ─────────────────────────
// ord_psbl_cash_amt: 실시간 주문가능현금금액 (최우선 사용)
// prvs_rcdl_excc_amt: 전일매매실현금액 (ord_psbl_cash_amt 없을 때 fallback)

export async function getAvailableCash(): Promise<number> {
  const headers = await makeHeaders('TTTC8434R');
  const { accountId } = getEnv();
  const [cano, acntPrdtCd] = splitAccountId(accountId);

  const res = await axios.get<{
    rt_cd: string;
    msg1: string;
    output2: Array<{
      ord_psbl_cash_amt:  string; // 주문가능현금금액 (실시간 주문 가능 현금)
      prvs_rcdl_excc_amt: string; // 전일매매실현금액 (fallback)
      dnca_tot_amt:       string;
      nass_amt:           string;
    }>;
  }>(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance`,
    {
      params: {
        CANO:                   cano,
        ACNT_PRDT_CD:           acntPrdtCd || '01',
        AFHR_FLPR_YN:           'N',
        OFL_YN:                 '',
        INQR_DVSN:              '02',
        UNPR_DVSN:              '01',
        FUND_STTL_ICLD_YN:      'N',
        FNCG_AMT_AUTO_RDPT_YN:  'N',
        PRCS_DVSN:              '01',
        CTX_AREA_FK100:         '',
        CTX_AREA_NK100:         '',
      },
      headers,
      timeout: 5_000,
    }
  );

  const { rt_cd, msg1, output2 } = res.data;
  if (rt_cd !== '0') throw new Error(`KIS 잔고조회 실패: ${msg1}`);

  const row = output2?.[0];
  // ord_psbl_cash_amt: 실시간 주문가능현금. 없으면 prvs_rcdl_excc_amt fallback
  return parseInt(row?.ord_psbl_cash_amt ?? row?.prvs_rcdl_excc_amt ?? '0', 10);
}

// ── 실제 보유 포지션 조회 ─────────────────────────────────────

export interface RealPosition {
  code:         string;
  name:         string;
  quantity:     number;
  avgPrice:     number;
  currentValue: number;
}

export async function getRealPositions(): Promise<RealPosition[]> {
  const headers = await makeHeaders('TTTC8434R');
  const { accountId } = getEnv();
  const [cano, acntPrdtCd] = splitAccountId(accountId);

  const res = await axios.get<{
    rt_cd: string;
    msg1: string;
    output1: Array<{
      pdno: string;
      prdt_name: string;
      hldg_qty: string;
      pchs_avg_pric: string;
      evlu_amt: string;
    }>;
  }>(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance`,
    {
      params: {
        CANO:                   cano,
        ACNT_PRDT_CD:           acntPrdtCd || '01',
        AFHR_FLPR_YN:           'N',
        OFL_YN:                 '',
        INQR_DVSN:              '02',
        UNPR_DVSN:              '01',
        FUND_STTL_ICLD_YN:      'N',
        FNCG_AMT_AUTO_RDPT_YN:  'N',
        PRCS_DVSN:              '01',
        CTX_AREA_FK100:         '',
        CTX_AREA_NK100:         '',
      },
      headers,
      timeout: 5_000,
    }
  );

  const { rt_cd, msg1, output1 } = res.data;
  if (rt_cd !== '0') throw new Error(`KIS 포지션조회 실패: ${msg1}`);

  return (output1 ?? [])
    .filter((r) => parseInt(r.hldg_qty, 10) > 0)
    .map((r) => ({
      code:         r.pdno,
      name:         r.prdt_name,
      quantity:     parseInt(r.hldg_qty, 10),
      avgPrice:     parseFloat(r.pchs_avg_pric),
      currentValue: parseInt(r.evlu_amt ?? '0', 10),
    }));
}
