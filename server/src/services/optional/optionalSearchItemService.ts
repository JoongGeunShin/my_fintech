import axios from "axios";
import { clearTokenCache, getAccessToken } from "../../services/kis/tokenService";
import { KisOpstionalSearchResponse, OptionalSearchList } from "../../types/optional/optionalSearchItem";

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

// ... 상단 import 생략

export async function getOptionalSearchItem(sequence: string): Promise<OptionalSearchList> {
    const appKey = process.env.KIS_API_APP_KEY;
    const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;
    const userId = process.env.KIS_ACCOUNT_ID;

    if (!appKey || !appSecretKey || !userId) {
        throw new Error('API 설정(Key 또는 ID) 환경변수가 누락되었습니다.');
    }

    let accessToken: string;
    try {
        accessToken = await getAccessToken();
    } catch (err) {
        throw new Error(`토큰 발급 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }

    try {
        const response = await axios.get<KisOpstionalSearchResponse>(
            `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/psearch-title`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'appkey': appKey,
                    'appsecret': appSecretKey,
                    'custtype': 'P',
                    'tr_id': 'HHKST03900400',
                },
                params: {
                    user_id: userId,
                    seq: sequence,
                },
                timeout: 10000, 
            }
        );

        const { rt_cd, msg1, output2 } = response.data;

        if (rt_cd !== '0') {
            throw new Error(`KIS API 오류: ${msg1} (코드: ${rt_cd})`);
        }

        if (!output2 || output2.length === 0) {
            throw new Error(`조건 검색 항목이 존재하지 않습니다. (seq: ${sequence})`);
        }

        return {
            seq: sequence,
            list: output2.map(item => ({
                code: item.code,
                name: item.name,
                daebi: item.daebi,
                price: item.price,
                changeRate: item.chgrate, // 오타 수정
                tradeVolume: item.acml_vol,
                tradeAmount: item.trade_amt,
                change: item.change,
                gangdo: item.cttr,
                openPrice: item.open,
                highPrice: item.high,
                lowPrice: item.low,
                high52Price: item.high52,
                low52Price: item.low52,
                expectPrice: item.expprice,
                expectChange: item.expchange,
                expectChangeRate: item.expchggrate,
                expectVolume: item.expcvol,
                changeRateYesterday: item.chgrate2,
                expectDaebi: item.expdaebi,
                recprice: item.recprice,
                uplmtprice: item.uplmtprice,
                dnlmtprice: item.dnlmtprice,
                stotprice: item.stotprice,
                chnageRate: item.chgrate, // 추가: chnageRate 필드도 포함 (오타 수정)
            })),
        };
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
            clearTokenCache();
            throw new Error('인증 토큰이 만료되었습니다. 다시 시도해주세요.');
        }
        throw new Error(`KIS API 요청 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
}