import axios from 'axios';
import type { KisStockPriceResponse, StockPrice } from '../types/kis.js';
import { clearTokenCache, getAccessToken } from './tokenService.js';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

// 전일 대비 부호 → 사람이 읽기 좋은 문자로 변환
const CHANGE_SIGN_MAP: Record<string, string> = {
  '1': '상한',
  '2': '상승',
  '3': '보합',
  '4': '하락',
  '5': '하한',
};

/**
 * 국내 주식 현재가 조회
 * @param stockCode 종목 코드 (예: "005930" = 삼성전자)
 */
export async function getDomesticStockPrice(stockCode: string): Promise<StockPrice> {
  const appKey = process.env.KIS_API_APP_KEY;
  const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;

  if (!appKey || !appSecretKey) {
    throw new Error('API 키 환경변수가 설정되지 않았습니다.');
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    throw new Error(`토큰 발급 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  }

  try {
    const response = await axios.get<KisStockPriceResponse>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`,
      {
        params: {
          FID_COND_MRKT_DIV_CODE: 'J', // J: 주식, ETF, ETN
          FID_INPUT_ISCD: stockCode,
        },
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          appkey: appKey,
          appsecret: appSecretKey,
          tr_id: 'FHKST01010100', // 주식 현재가 시세 TR ID
        },
      }
    );

    const { rt_cd, msg1, output } = response.data;

    // KIS API 응답 코드 확인 ("0"이 정상)
    if (rt_cd !== '0') {
      throw new Error(`KIS API 오류: ${msg1} (코드: ${rt_cd})`);
    }

    // 숫자 파싱 헬퍼
    const toNum = (val: string) => parseFloat(val) || 0;
    const toInt = (val: string) => parseInt(val, 10) || 0;

    const result: StockPrice = {
      code: stockCode,
      name: output.hts_kor_isnm,
      market: output.rprs_mrkt_kor_name,
      sector: output.bstp_kor_isnm,
      currentPrice: toInt(output.stck_prpr),
      change: toInt(output.prdy_vrss),
      changeSign: CHANGE_SIGN_MAP[output.prdy_vrss_sign] ?? output.prdy_vrss_sign,
      changeRate: toNum(output.prdy_ctrt),
      openPrice: toInt(output.stck_oprc),
      highPrice: toInt(output.stck_hgpr),
      lowPrice: toInt(output.stck_lwpr),
      prevClosePrice: toInt(output.stck_prdy_clpr),
      upperLimit: toInt(output.stck_mxpr),
      lowerLimit: toInt(output.stck_llam),
      volume: toInt(output.acml_vol),
      tradingValue: toInt(output.acml_tr_pbmn),
      askPrice: toInt(output.askp),
      bidPrice: toInt(output.bidp),
      prevVolume: toInt(output.prdy_vol),
      investCaution: output.invt_caful_yn === 'Y',
      marketWarning: output.mrkt_warn_cls_code,
    };

    return result;
  } catch (err) {
    // 401 Unauthorized → 토큰 캐시 초기화 후 재시도 가능하도록 전파
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      clearTokenCache();
      throw new Error('인증 토큰이 만료되었습니다. 다시 시도해주세요.');
    }
    throw err;
  }
}
