import axios from "axios";
import {StockPeriodPriceSpecified } from "../../types/kis/periodPriceSpecified";
import { getAccessToken } from "./tokenService";
// import { KisStockPeriodSpecifiedResponse, Stck } from "../../types/kis/periodPriceSpecified";

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export async function getDomesticPeriodStockPriceSpecified1(stockCode: string, market: string = 'UN', 
    period: string = 'D'): Promise<StockPeriodPriceSpecified> {
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
            `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price-spec`,
            {
                params: {
                    FID_COND_MRKT_DIV_CODE: market, // J: 주식
    }
}