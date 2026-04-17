import axios from 'axios';
import { KisStockPeriodResponse, StockPeriodPrice } from '../../types/kis/periodPrice';
import { clearTokenCache, getAccessToken } from './tokenService';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export async function getDomesticPeriodStockPrice(stockCode: string, market: string = 'UN', period: string = 'D'): Promise<StockPeriodPrice> {
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
    const response = await axios.get<KisStockPeriodResponse>(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`,
      {
        params: {
          FID_COND_MRKT_DIV_CODE: market, // J: 주식, ETF, ETN
          FID_INPUT_ISCD: stockCode,
          FID_PERIOD_DIV_CODE: period, // D: 일, M: 월, Y: 년
          FID_ORG_ADJ_PRC: '0', // 수정주가 포함 여부 (0: 미포함, 1: 포함) - 기본시세와 동일한 데이터 구조 반환 위해 미포함으로 설정
        },
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          appkey: appKey,
          appsecret: appSecretKey,
          tr_id: 'FHKST01010400', // 주식 현재가 일자별 시세 TR ID
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

    const result: StockPeriodPrice = {
      code: stockCode,
      dailyPrices: output.map((period) => ({
        date: period.stck_bsop_date,
        closePrice: toNum(period.stck_clpr),
        openPrice: toNum(period.stck_oprc),
        highPrice: toNum(period.stck_hgpr),
        lowPrice: toNum(period.stck_lwpr),
        volume: toNum(period.acml_vol),
        change: toNum(period.prdy_vrss),
        changeRate: toNum(period.prdy_ctrt),
      })),
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