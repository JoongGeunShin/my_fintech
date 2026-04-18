import axios from "axios";
import { KisStockInvestorResponse, StockInvestor } from "../../types/kis/stockInvestors";
import { getAccessToken } from "./tokenService";

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export async function getStockInvestorInfo(stockCode: string, market: string = 'UN'): Promise<StockInvestor> {
    const appKey = process.env.KIS_API_APP_KEY;
    const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;

    if(!appKey || !appSecretKey){
        throw new Error('API 키 환경변수가 설정되지 않았습니다.');
    }
    let accessToken: string;
    try{
        accessToken = await getAccessToken();
    } catch (err) {
        throw new Error(`토큰 발급 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
    try {
        const response = await axios.get<KisStockInvestorResponse>(
            `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor`,
            {
                params: {
                    FID_COND_MRKT_DIV_CODE: market, // J:KRX, NX:NXT, UN:전체
                    FID_INPUT_ISCD: stockCode,
                },
                headers:{
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    appkey: appKey,
                    appsecret: appSecretKey,
                    tr_id: 'FHKST01010900',
                },
            }
        );
        const { rt_cd, msg1, output } = response.data;

        // KIS API 응답 코드 확인 ("0"이 정상)
        if(rt_cd !== '0') {
            throw new Error(`KIS API 오류: ${msg1} (코드: ${rt_cd})`);
        }
        // const data = output[0]; // 최신 데이터 1개만 사용
        // 숫자 파싱 헬퍼
        const toNum = (val: string) => parseFloat(val) || 0;
        const toInt = (val: string) => parseInt(val, 10) || 0;
        const result: StockInvestor = {
            date: output[0].stck_bsop_date,
            closePrice: toNum(output[0].stck_clpr),
            change: toNum(output[0].prdy_vrss),
            changeSign: output[0].prdy_vrss_sign,
            personalNetBuyVolume: toInt(output[0].prsn_ntby_qy),
            foreignNetBuyVolume: toInt(output[0].frgn_ntby_qy),
            institutionalNetBuyVolume: toInt(output[0].orgn_ntby_qy),
            personalNetBuyValue: toNum(output[0].prsn_nbty_tr_pbmn),
            foreignNetBuyValue: toNum(output[0].frng_ntby_tr_pbmn),
            institutionalNetBuyValue: toNum(output[0].orgn_ntby_tr_pbmn),
            personalSellVolume: toInt(output[0].prsn_seln_vol),
            foreignSellVolume: toInt(output[0].frgn_seln_vol),
            institutionalSellVolume: toInt(output[0].orgn_seln_vol),
            personalSellValue: toNum(output[0].prsn_seln_tr_pbmn),
            foreignSellValue: toNum(output[0].frgn_seln_tr_pbmn),
            institutionalSellValue: toNum(output[0].orgn_seln_tr_pbmn),
        };
        return result;
    } catch (err) {
        if(axios.isAxiosError(err)) {
            throw new Error(`HTTP 요청 실패: ${err.message}`);
        }
        throw new Error(`알 수 없는 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
}