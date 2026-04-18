import axios from "axios";
import { KisStockPeriodSpecifiedResponse, StockPeriodPriceSpecified } from "../../types/kis/periodPriceSpecified";
import { getAccessToken } from "./tokenService";
// import { KisStockPeriodSpecifiedResponse, Stck } from "../../types/kis/periodPriceSpecified";

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export async function getDomesticPeriodStockPriceSpecified(stockCode: string, market: string = 'UN', 
    startDate: string, endDate: string, period: string = 'D'): Promise<StockPeriodPriceSpecified> {
    const appKey = process.env.KIS_API_APP_KEY;
    const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;

    if(!appKey || !appSecretKey) {
        throw new Error('API 키 환경변수가 설정되지 않았습니다.');
    }

    let accessToken: string;
    try{
        accessToken = await getAccessToken();
    } catch (err) {
        throw new Error(`토큰 발급 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
    try {
        const response = await axios.get<KisStockPeriodSpecifiedResponse>(
            `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,
            {
                params: {
                    FID_COND_MRKT_DIV_CODE: market, // J:KRX, NX:NXT, UN:전체
                    FID_INPUT_ISCD: stockCode,
                    FID_INPUT_DATE_1: startDate, // 조회 시작일 (YYYYMMDD)
                    FID_INPUT_DATE_2: endDate,   // 조회 종료일 (YYYYMMDD)
                    FID_PERIOD_DIV_CODE: period, // D: 일, M: 월, Y: 년
                    FID_ORG_ADJ_PRC: '1', // 수정주가 포함 여부 (0: 수정주가, 1: 원주가)
                },
                headers:{
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    appkey: appKey,
                    appsecret: appSecretKey,
                    custtype: 'P', // 고객 유형 (P: 개인, B: 법인)
                    tr_id: 'FHKST03010100', // 주식 현재가 기간별 시세 TR ID
                }, 
            }
        );

        const { rt_cd, msg1, output1, output2 } = response.data;

        // KIS API 응답 코드 확인 ("0"이 정상)
        if(rt_cd !== '0') {
            throw new Error(`KIS API 오류: ${msg1} (코드: ${rt_cd})`);
        }
        // 숫자 파싱 헬퍼
        const toNum = (val: string) => parseFloat(val) || 0;
        const result: StockPeriodPriceSpecified = {
            code: stockCode,
            // name: output1.hts_kor_isnm,
            name: stockCode, // KIS API 응답에 종목명이 없어서 코드로 대체 (필요시 별도 API로 종목명 조회 가능)

            summary:{
                currentPrice: toNum(output1.stck_prpr),
                change: toNum(output1.prdy_vrss),
                changeRate: toNum(output1.prdy_ctrt),
                changeSign: output1.prdy_vrss_sign,
                prevClosePrice: toNum(output1.stck_prdy_clpr),
                openPrice: toNum(output1.stck_oprc),
                highPrice: toNum(output1.stck_hgpr),
                lowPrice: toNum(output1.stck_lwpr),
                prevOpenPrice: toNum(output1.stck_prdy_oprc),
                prevHighPrice: toNum(output1.stck_prdy_hgpr),
                prevLowPrice: toNum(output1.stck_prdy_lwpr),
                volume: toNum(output1.prdy_vol),
                tradingValue: toNum(output1.acml_tr_pbmn),
                prevVolume: toNum(output1.acml_vol),
                upperLimit: toNum(output1.stck_mxpr),
                lowerLimit: toNum(output1.stck_llam),
                askPrice: toNum(output1.askp),
                bidPrice: toNum(output1.bidp),
                marketCap: toNum(output1.hts_avls),
                faceValue: toNum(output1.stck_fcam),
                listedShares: toNum(output1.lstn_stcn),
                capital: toNum(output1.cpfn),
                per: toNum(output1.per),
                eps: toNum(output1.eps),
                pbr: toNum(output1.pbr),
                volumeTurnoverRate: toNum(output1.vol_tnrt),
                loanRemainRate: toNum(output1.itewhol_loan_rmnd_ratem),
            },
            dailyPrices: output2.map((item) => ({
                date: item.stck_bsop_date,
                closePrice: toNum(item.stck_clpr),
                openPrice: toNum(item.stck_oprc),
                highPrice: toNum(item.stck_hgpr),
                lowPrice: toNum(item.stck_lwpr),
                volume: toNum(item.acml_vol),
                tradingValue: toNum(item.acml_tr_pbmn),
                change: toNum(item.prdy_vrss),
                changeSign: item.prdy_vrss_sign,
                isSplit: item.prtt_rate !== '0', // 분할 여부는 분할 비율이 0이 아닌 경우로 판단
                splitRatio: toNum(item.prtt_rate),
                exDividendType: item.flng_cls_code, // 락 구분 코드로 배당락 여부 판단 가능
            })),
        };

        return result;
    } catch (err) {
        throw new Error(`KIS API 호출 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
}