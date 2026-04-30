import WebSocket from 'ws';
import { getWebSocketApprovalKey } from './tokenService.js';

// ── KIS 실시간 데이터 타입 ───────────────────────────────────

/** 실시간 호가 (TR: H0STASP0) */
export interface RealtimeOrderBook {
  code: string;              // 종목코드
  timestamp: string;         // 영업시각 (HHmmss)
  totalAskVolume: number;    // 총 매도호가 잔량
  totalBidVolume: number;    // 총 매수호가 잔량
  askPrices: number[];       // 매도호가 1~10
  askVolumes: number[];      // 매도호가 잔량 1~10
  bidPrices: number[];       // 매수호가 1~10
  bidVolumes: number[];      // 매수호가 잔량 1~10
  askLevelPrices: number[];  // 예상 매도호가
  bidLevelPrices: number[];  // 예상 매수호가
}

/** 실시간 체결가 (TR: H0STCNT0) */
export interface RealtimeTrade {
  code: string;              // 종목코드
  timestamp: string;         // 체결시각 (HHmmss)
  tradePrice: number;        // 체결가
  tradeVolume: number;       // 체결량
  tradeAmount: number;       // 체결대금
  changePrice: number;       // 전일 대비
  changeRate: number;        // 전일 대비율
  changeSign: string;        // 전일 대비 부호 (1:상한 2:상승 3:보합 4:하락 5:하한)
  accVolume: number;         // 누적 체결량
  accAmount: number;         // 누적 체결대금
  highPrice: number;         // 당일 고가
  lowPrice: number;          // 당일 저가
  openPrice: number;         // 당일 시가
  bidReqCount: number;       // 매수 체결건수
  askReqCount: number;       // 매도 체결건수
  netBidVolume: number;      // 순매수 체결량
}

// ── 구독 TR ID 상수 ──────────────────────────────────────────
const TR_ID = {
  ORDER_BOOK: 'H0STASP0',  // 국내주식 실시간 호가
  TRADE:      'H0STCNT0',  // 국내주식 실시간 체결가
} as const;

type TrId = typeof TR_ID[keyof typeof TR_ID];

// ── KIS 웹소켓 URL ───────────────────────────────────────────
const KIS_WS_URL = 'ws://ops.koreainvestment.com:21000';

// ── 콜백 타입 ────────────────────────────────────────────────
type OrderBookCallback = (data: RealtimeOrderBook) => void;
type TradeCallback     = (data: RealtimeTrade) => void;

// ── 싱글턴 서비스 ────────────────────────────────────────────

class KisWebSocketService {
  private ws: WebSocket | null = null;
  private approvalKey: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;

  // 구독 중인 종목 추적 (재연결 시 재구독)
  private orderBookSubs = new Set<string>();
  private tradeSubs     = new Set<string>();

  // 콜백 레지스트리
  private orderBookCallbacks = new Map<string, Set<OrderBookCallback>>();
  private tradeCallbacks     = new Map<string, Set<TradeCallback>>();

  // ── 연결 ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.approvalKey = await getWebSocketApprovalKey();
    } catch (err) {
      console.error('[KIS-WS] 접속키 발급 실패:', err instanceof Error ? err.message : err);
      this._scheduleReconnect();
      return;
    }

    this.ws = new WebSocket(KIS_WS_URL);

    this.ws.on('open', () => {
      console.log('[KIS-WS] 연결됨');
      this._resubscribeAll();
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      this._handleMessage(raw.toString());
    });

    this.ws.on('error', (err) => {
      console.error('[KIS-WS] 오류:', err.message);
    });

    this.ws.on('close', (code, reason) => {
      console.warn(`[KIS-WS] 연결 종료 (code=${code}, reason=${reason.toString()})`);
      if (!this.isShuttingDown) this._scheduleReconnect();
    });
  }

  disconnect(): void {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    console.log('[KIS-WS] 연결 해제');
  }

  // ── 구독 / 해제 ───────────────────────────────────────────

  subscribeOrderBook(code: string, cb: OrderBookCallback): void {
    this._addCallback(this.orderBookCallbacks, code, cb);
    if (!this.orderBookSubs.has(code)) {
      this.orderBookSubs.add(code);
      this._sendSubscribe(TR_ID.ORDER_BOOK, code);
    }
  }

  unsubscribeOrderBook(code: string, cb: OrderBookCallback): void {
    this._removeCallback(this.orderBookCallbacks, code, cb);
    if (!this.orderBookCallbacks.has(code)) {
      this.orderBookSubs.delete(code);
      this._sendUnsubscribe(TR_ID.ORDER_BOOK, code);
    }
  }

  subscribeTrade(code: string, cb: TradeCallback): void {
    this._addCallback(this.tradeCallbacks, code, cb);
    if (!this.tradeSubs.has(code)) {
      this.tradeSubs.add(code);
      this._sendSubscribe(TR_ID.TRADE, code);
    }
  }

  unsubscribeTrade(code: string, cb: TradeCallback): void {
    this._removeCallback(this.tradeCallbacks, code, cb);
    if (!this.tradeCallbacks.has(code)) {
      this.tradeSubs.delete(code);
      this._sendUnsubscribe(TR_ID.TRADE, code);
    }
  }

  // ── 내부 유틸 ─────────────────────────────────────────────

  private _addCallback<T>(
    registry: Map<string, Set<T>>,
    code: string,
    cb: T
  ): void {
    if (!registry.has(code)) registry.set(code, new Set());
    registry.get(code)!.add(cb);
  }

  private _removeCallback<T>(
    registry: Map<string, Set<T>>,
    code: string,
    cb: T
  ): void {
    const set = registry.get(code);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) registry.delete(code);
  }

  private _sendSubscribe(trId: TrId, code: string): void {
    this._send('1', trId, code);
  }

  private _sendUnsubscribe(trId: TrId, code: string): void {
    this._send('2', trId, code);
  }

  private _send(trType: '1' | '2', trId: TrId, code: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[KIS-WS] 미연결 상태 - ${trType === '1' ? '구독' : '해제'} 대기 (${code})`);
      return;
    }
    const payload = {
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: trType,   // '1': 등록, '2': 해제
        'content-type': 'utf-8',
      },
      body: {
        input: {
          tr_id: trId,
          tr_key: code,
        },
      },
    };
    this.ws.send(JSON.stringify(payload));
    console.log(`[KIS-WS] ${trType === '1' ? '구독' : '해제'} 전송: ${trId} / ${code}`);
  }

  private _resubscribeAll(): void {
    for (const code of this.orderBookSubs) this._sendSubscribe(TR_ID.ORDER_BOOK, code);
    for (const code of this.tradeSubs)     this._sendSubscribe(TR_ID.TRADE, code);
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = 5_000;
    console.log(`[KIS-WS] ${delay / 1000}초 후 재연결 시도...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.approvalKey = null; // 키 갱신
      await this.connect();
    }, delay);
  }

  // ── 메시지 파싱 ───────────────────────────────────────────

  private _handleMessage(raw: string): void {
    // PINGPONG 응답
    if (raw === 'PINGPONG') {
      this.ws?.send('PINGPONG');
      return;
    }

    // JSON (구독 응답 / PINGPONG / 오류 등)
    if (raw.startsWith('{')) {
      try {
        const json = JSON.parse(raw) as {
          header?: { tr_id?: string; tr_key?: string; datetime?: string };
          body?: { rt_cd?: string; msg1?: string };
        };

        // KIS JSON PINGPONG 응답 — 동일 JSON을 그대로 돌려보냄
        if (json.header?.tr_id === 'PINGPONG') {
          this.ws?.send(raw);
          return;
        }

        const rtCd = json.body?.rt_cd;
        const msg  = json.body?.msg1
          ?? (json.body as Record<string, unknown>)?.msg_cd as string | undefined
          ?? JSON.stringify(json.body);

        if (rtCd === '0') {
          console.log(`[KIS-WS] 구독 응답: ${json.header?.tr_id}/${json.header?.tr_key} → ${msg}`);
        } else if (rtCd !== undefined) {
          console.error(`[KIS-WS] 구독 거부 (rt_cd=${rtCd}): ${msg}`);
          console.error(`[KIS-WS] 원본:`, raw.slice(0, 300));
        } else {
          console.log(`[KIS-WS] 시스템 메시지: ${raw.slice(0, 200)}`);
        }
      } catch { /* ignore */ }
      return;
    }

    // 실시간 데이터: "|" 구분자
    // KIS 포맷: encrypt_yn | tr_id | data_cnt | data_body
    const parts = raw.split('|');
    if (parts.length < 4) return;

    const trId = parts[1];
    const body = parts[3];

    // 디버그: 모든 파이프 메시지
    console.log(`[KIS-WS] PIPE parts=${parts.length} [0]=${parts[0]} [1]=${trId} [2]=${parts[2]} body_head=${body?.slice(0, 40)}`);

    if (trId === TR_ID.ORDER_BOOK) {
      const parsed = this._parseOrderBook(body);
      if (parsed) this._emitOrderBook(parsed);
    } else if (trId === TR_ID.TRADE) {
      const parsed = this._parseTrade(body);
      if (parsed) this._emitTrade(parsed);
    }
  }

  private _emitOrderBook(data: RealtimeOrderBook): void {
    const cbs = this.orderBookCallbacks.get(data.code);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(data); } catch (e) { console.error('[KIS-WS] OrderBook 콜백 오류:', e); }
    }
  }

  private _emitTrade(data: RealtimeTrade): void {
    const cbs = this.tradeCallbacks.get(data.code);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(data); } catch (e) { console.error('[KIS-WS] Trade 콜백 오류:', e); }
    }
  }

  // ── 파서: 실시간 호가 (H0STASP0) ─────────────────────────
  // 전문 구성 (^ 구분자, 총 54필드)
  private _parseOrderBook(body: string): RealtimeOrderBook | null {
    try {
      const f = body.split('^');
      if (f.length < 54) return null;

      const toNum = (v: string) => parseFloat(v) || 0;
      const toInt = (v: string) => parseInt(v, 10) || 0;

      // f[0]: 유가증권단축종목코드
      // f[1]: 영업시각
      // f[2]: 임의처리구분코드
      // f[3]~f[12]:  매도호가 1~10
      // f[13]~f[22]: 매수호가 1~10
      // f[23]~f[32]: 매도호가 잔량 1~10
      // f[33]~f[42]: 매수호가 잔량 1~10
      // f[43]: 총 매도호가 잔량
      // f[44]: 총 매수호가 잔량
      // f[45]~f[54]: 예상 체결가 등 (필요 시 확장)

      const askPrices:   number[] = [];
      const bidPrices:   number[] = [];
      const askVolumes:  number[] = [];
      const bidVolumes:  number[] = [];
      const askLevelPrices: number[] = [];
      const bidLevelPrices: number[] = [];

      for (let i = 0; i < 10; i++) {
        askPrices.push(toNum(f[3 + i]));
        bidPrices.push(toNum(f[13 + i]));
        askVolumes.push(toInt(f[23 + i]));
        bidVolumes.push(toInt(f[33 + i]));
      }

      // 예상 매도/매수 (f[45]~ 구조에 따라 조정 필요)
      for (let i = 0; i < 5 && 45 + i < f.length; i++) {
        askLevelPrices.push(toNum(f[45 + i]));
      }
      for (let i = 0; i < 5 && 50 + i < f.length; i++) {
        bidLevelPrices.push(toNum(f[50 + i]));
      }

      return {
        code: f[0],
        timestamp: f[1],
        totalAskVolume: toInt(f[43]),
        totalBidVolume: toInt(f[44]),
        askPrices,
        askVolumes,
        bidPrices,
        bidVolumes,
        askLevelPrices,
        bidLevelPrices,
      };
    } catch (err) {
      console.error('[KIS-WS] 호가 파싱 오류:', err);
      return null;
    }
  }

  // ── 파서: 실시간 체결가 (H0STCNT0) ──────────────────────
  // 전문 구성 (^ 구분자, 총 46필드)
  private _parseTrade(body: string): RealtimeTrade | null {
    try {
      const f = body.split('^');
      if (f.length < 30) return null;

      const toNum = (v: string) => parseFloat(v) || 0;
      const toInt = (v: string) => parseInt(v, 10) || 0;

      // f[0]:  유가증권단축종목코드
      // f[1]:  주식 체결 시간
      // f[2]:  주식 현재가 (체결가)
      // f[3]:  전일 대비 부호
      // f[4]:  전일 대비
      // f[5]:  전일 대비율
      // f[6]:  가중 평균 주식 가격
      // f[7]:  주식 시가
      // f[8]:  주식 최고가
      // f[9]:  주식 최저가
      // f[10]: 매도호가1
      // f[11]: 매수호가1
      // f[12]: 체결 거래량
      // f[13]: 누적 거래량
      // f[14]: 누적 거래 대금
      // f[15]: 매도체결건수
      // f[16]: 매수체결건수
      // f[17]: 순매수체결량 (매수-매도)
      // f[18]: 체결강도
      // f[19]: 총 매도 수량
      // f[20]: 총 매수 수량
      // f[21]: 체결구분 (매수/매도)
      // f[22]: 매수비율
      // f[23]: 전일 거래량 대비 등락률
      // f[24]: 시간구분코드
      // f[25]: 임의종료구분코드
      // f[26]: 장운영구분코드
      // f[27]: 전일동시간누적거래량
      // f[28]: 전일동시간누적거래량비율
      // f[29]: 이론 가격 (ELW 등)

      return {
        code:        f[0],
        timestamp:   f[1],
        tradePrice:  toNum(f[2]),
        changeSign:  f[3],
        changePrice: toNum(f[4]),
        changeRate:  toNum(f[5]),
        openPrice:   toNum(f[7]),
        highPrice:   toNum(f[8]),
        lowPrice:    toNum(f[9]),
        tradeVolume: toInt(f[12]),
        accVolume:   toInt(f[13]),
        accAmount:   toNum(f[14]),
        askReqCount: toInt(f[15]),
        bidReqCount: toInt(f[16]),
        netBidVolume: toInt(f[17]),
        tradeAmount:  toNum(f[2]) * toInt(f[12]), // 체결가 × 체결량
      };
    } catch (err) {
      console.error('[KIS-WS] 체결 파싱 오류:', err);
      return null;
    }
  }
}

// 싱글턴 export
export const kisWebSocketService = new KisWebSocketService();
