import axios from 'axios';
import type { KisTokenResponse } from '../types/kis.js';

interface CachedToken {
  accessToken: string;
  expiresAt: Date;
}

let tokenCache: CachedToken | null = null;

const KIS_BASE_URL = process.env.KIS_BASE_URL;

export async function getAccessToken(): Promise<string> {
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (tokenCache && tokenCache.expiresAt > fiveMinutesFromNow) {
    return tokenCache.accessToken;
  }

  const appKey = process.env.KIS_API_APP_KEY;
  const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;

  if (!appKey || !appSecretKey) {
    throw new Error('KIS_API_APP_KEY 또는 KIS_API_APP_SECRET_KEY 환경변수가 설정되지 않았습니다.');
  }

  console.log('[Token] 새 액세스 토큰 발급 요청 중...');

  const response = await axios.post<KisTokenResponse>(
    `${KIS_BASE_URL}/oauth2/tokenP`,
    {
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecretKey,
    },
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const { access_token, expires_in } = response.data;

  const expiresAt = new Date(now.getTime() + expires_in * 1000);
  tokenCache = { accessToken: access_token, expiresAt };
  console.log(`[Token] 토큰 발급 완료. 만료: ${expiresAt.toLocaleString('ko-KR')}`);

  return access_token;
}

export function clearTokenCache(): void {
  tokenCache = null;
  console.log('[Token] 토큰 캐시 초기화됨');
}
