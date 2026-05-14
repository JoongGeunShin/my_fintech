import axios from 'axios';
import type { KisTokenResponse } from '../../types/kis/common.js';

// KIS API 액세스 토큰
interface CachedToken {
  accessToken: string;
  expiresAt: Date;
}

let tokenCache: CachedToken | null = null;
let tokenFetchPromise: Promise<string> | null = null;
// KIS API 웹소켓 토큰
interface CachedApprovalKey{
  approvalKey: string;
  expiresAt: Date;
}
let wsKeyCache: CachedApprovalKey | null = null;
let wsKeyFetchPromise: Promise<string> | null = null;

const KIS_BASE_URL = process.env.KIS_BASE_URL ?? 'https://openapi.koreainvestment.com:9443';

export async function getAccessToken(): Promise<string> {
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (tokenCache && tokenCache.expiresAt > fiveMinutesFromNow) {
    return tokenCache.accessToken;
  }

  if (tokenFetchPromise) {
    console.log('[Token] 토큰 발급 중... 대기');
    return tokenFetchPromise;
  }

  tokenFetchPromise = _fetchNewToken().finally(() => {
    tokenFetchPromise = null;
  });

  return tokenFetchPromise;
}

async function _fetchNewToken(): Promise<string> {
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
      timeout: 10_000,
    }
  );

  const { access_token, expires_in } = response.data;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expires_in * 1000);
  tokenCache = { accessToken: access_token, expiresAt };
  console.log(`[Token] 토큰 발급 완료. 만료: ${expiresAt.toLocaleString('ko-KR')}`);

  return access_token;
}

export function clearTokenCache(): void {
  tokenCache = null;
  tokenFetchPromise = null;
  console.log('[Token] 토큰 캐시 초기화됨');
}

export async function getWebSocketApprovalKey(): Promise<string> {
  const now                = new Date();
  const tenMinutesFromNow  = new Date(now.getTime() + 10 * 60 * 1000);
 
  if (wsKeyCache && wsKeyCache.expiresAt > tenMinutesFromNow) {
    console.log('[WS-Key] 캐시된 접속키 사용');
    return wsKeyCache.approvalKey;
  }
 
  if (wsKeyFetchPromise) {
    console.log('[WS-Key] 접속키 발급 중... 대기');
    return wsKeyFetchPromise;
  }
 
  wsKeyFetchPromise = _fetchNewApprovalKey().finally(() => {
    wsKeyFetchPromise = null;
  });
 
  return wsKeyFetchPromise;
}

async function _fetchNewApprovalKey(): Promise<string> {
  const appKey       = process.env.KIS_API_APP_KEY;
  const appSecretKey = process.env.KIS_API_APP_SECRET_KEY;
 
  if (!appKey || !appSecretKey) {
    throw new Error(
      'KIS_API_APP_KEY 또는 KIS_API_APP_SECRET_KEY 환경변수가 설정되지 않았습니다.'
    );
  }
 
  console.log('[WS-Key] 웹소켓 접속키 발급 요청 중...');
 
  const response = await axios.post<{ approval_key: string }>(
    `${KIS_BASE_URL}/oauth2/Approval`,
    {
      grant_type: 'client_credentials',
      appkey: appKey,
      secretkey: appSecretKey, // 웹소켓 발급 파라미터는 secretkey
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    }
  );
 
  const approvalKey = response.data.approval_key;
  if (!approvalKey) {
    throw new Error('[WS-Key] approval_key가 응답에 없습니다.');
  }
 
  // 24시간 유효, 10분 여유를 두고 갱신하므로 23h50m 후 만료로 설정
  const expiresAt = new Date(Date.now() + (24 * 60 - 10) * 60 * 1000);
  wsKeyCache = { approvalKey, expiresAt };
 
  console.log(
    `[WS-Key] 접속키 발급 완료. 만료: ${expiresAt.toLocaleString('ko-KR')}`
  );
 
  return approvalKey;
}
 
export function clearWsKeyCache(): void {
  wsKeyCache        = null;
  wsKeyFetchPromise = null;
  console.log('[WS-Key] 웹소켓 접속키 캐시 초기화됨');
}