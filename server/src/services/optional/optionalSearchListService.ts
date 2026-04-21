import axios from "axios";
import { KisOptionalSearchListResponse, OptionalSearchList } from "../../types/optional/optionalSearchList";
import { getAccessToken } from "../kis/tokenService";


const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

export async function getOptionalSearchList(): Promise<OptionalSearchList>{
    const appKey = process.env.KIS_API_APP_KEY;
    const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;
    const userId = process.env.KIS_ACCOUNT_ID;

    if (!appKey || !appSecretKey || !userId) {
        throw new Error('API 설정(Key 또는 ID) 환경변수가 누락되었습니다.');
    }
    let accessToken: string;
    try{
        accessToken = await getAccessToken();
    } catch (err) {
        throw new Error(`토큰 발급 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
    try {
        const response = await axios.get<KisOptionalSearchListResponse>(
            `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/psearch-title`,
            {
                params: {
                    user_id: userId,
                },
                headers:{
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    appkey: appKey,
                    appsecret: appSecretKey,
                    custtype: 'P',
                    tr_id: 'HHKST03900300', 
                },
            }
        );
        const { rt_cd, msg1, output2 } = response.data;

        if(rt_cd !== '0') {
            throw new Error(`KIS API 오류: ${msg1} (코드: ${rt_cd})`);
        }

        const result: OptionalSearchList = {
            optionalSearchList: output2.map(item => ({
                user_id: item.user_id,
                sequence: item.seq,
                groupNumber: item.grp_nm,
                conditionNumber: item.condition_nm,
            })),
        };

        return result;
    } catch (error) {
        throw new Error(`KIS API 요청 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
}