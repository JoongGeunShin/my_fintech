import type { RealtimeOrderBook, RealtimeTrade } from '../../hooks/useRealtimeStock';
import './RealtimePanel.css';

function getAfterHoursLabel(): string | null {
  const now = new Date();
  const t   = now.getHours() * 60 + now.getMinutes();
  if (t >= 480  && t < 540)  return '장전 동시호가';
  if (t >= 930  && t < 960)  return '시간외 종가';
  if (t >= 960  && t < 1080) {
    const next = Math.ceil((t + 1) / 10) * 10;
    const h = Math.floor(next / 60);
    const m = next % 60;
    return `시간외 단일가 · 다음 체결 ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
  }
  return null;
}

function isAfterRegularClose(): boolean {
  const now = new Date();
  const t   = now.getHours() * 60 + now.getMinutes();
  return t >= 930; // 15:30 이후
}

interface RealtimePanelProps {
  code:            string | null;
  name?:           string;
  orderBook:       RealtimeOrderBook | null;
  trades:          RealtimeTrade[];
  latestTrade:     RealtimeTrade | null;
  isConnected:     boolean;
  isNxtSupported?: boolean | null;
}

const DISPLAY_LEVELS = 5;

function formatTime(ts: string): string {
  if (ts.length !== 6) return ts;
  return `${ts.slice(0, 2)}:${ts.slice(2, 4)}:${ts.slice(4, 6)}`;
}

function VolumeBar({ ratio, side }: { ratio: number; side: 'ask' | 'bid' }) {
  return (
    <div className={`rt-bar-wrap rt-bar-${side}`}>
      <div className="rt-bar" style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
    </div>
  );
}

function AskRow({ price, volume, ratio }: { price: number; volume: number; ratio: number }) {
  return (
    <div className="rt-ob-row rt-ob-ask">
      <span className="rt-ob-vol">{volume > 0 ? volume.toLocaleString() : '—'}</span>
      <VolumeBar ratio={ratio} side="ask" />
      <span className="rt-ob-price">{price > 0 ? price.toLocaleString() : '—'}</span>
    </div>
  );
}

function BidRow({ price, volume, ratio }: { price: number; volume: number; ratio: number }) {
  return (
    <div className="rt-ob-row rt-ob-bid">
      <span className="rt-ob-price">{price > 0 ? price.toLocaleString() : '—'}</span>
      <VolumeBar ratio={ratio} side="bid" />
      <span className="rt-ob-vol">{volume > 0 ? volume.toLocaleString() : '—'}</span>
    </div>
  );
}

function TradeRow({ trade }: { trade: RealtimeTrade }) {
  const isUp   = trade.changeSign === '1' || trade.changeSign === '2';
  const isDown = trade.changeSign === '4' || trade.changeSign === '5';
  const dir    = isUp ? '▲' : isDown ? '▼' : '─';
  const cls    = isUp ? 'rt-up' : isDown ? 'rt-down' : '';
  const isRest = trade.isAfterHours && trade.tradeVolume === 0;

  return (
    <div className={`rt-trade-row${isRest ? ' rt-trade-rest' : ''}`}>
      <span className="rt-trade-time">{formatTime(trade.timestamp)}</span>
      <span className={`rt-trade-price ${cls}`}>{trade.tradePrice.toLocaleString()}</span>
      <span className="rt-trade-vol">{isRest ? '—' : trade.tradeVolume.toLocaleString()}</span>
      <span className={`rt-trade-dir ${cls}`}>{dir}</span>
    </div>
  );
}

export default function RealtimePanel({
  code,
  name,
  orderBook,
  trades,
  latestTrade,
  isConnected,
  isNxtSupported,
}: RealtimePanelProps) {
  if (!code) {
    return (
      <section className="realtime-panel rt-empty-state">
        <div className="rt-placeholder">
          <span className="rt-placeholder-arrow">←</span>
          <p className="rt-placeholder-main">종목을 선택하세요</p>
          <p className="rt-placeholder-sub">스크리닝 패널의 종목을 클릭하면<br />실시간 호가·체결가가 표시됩니다</p>
        </div>
      </section>
    );
  }

  const afterClose     = isAfterRegularClose();
  const isNxtNo        = isNxtSupported === false && afterClose;
  const afterHoursLabel = getAfterHoursLabel();

  // 최대 볼륨 계산 (바 크기 기준)
  const askVols = orderBook?.askVolumes.slice(0, DISPLAY_LEVELS) ?? [];
  const bidVols = orderBook?.bidVolumes.slice(0, DISPLAY_LEVELS) ?? [];
  const maxVol  = Math.max(...askVols, ...bidVols, 1);

  const askPrices = orderBook?.askPrices.slice(0, DISPLAY_LEVELS) ?? [];
  const bidPrices = orderBook?.bidPrices.slice(0, DISPLAY_LEVELS) ?? [];

  const isUp        = latestTrade?.changeSign === '1' || latestTrade?.changeSign === '2';
  const isDown      = latestTrade?.changeSign === '4' || latestTrade?.changeSign === '5';
  const priceClass  = isUp ? 'rt-up' : isDown ? 'rt-down' : '';

  return (
    <section className="realtime-panel">
      {/* 헤더 */}
      <div className="rt-header">
        <div className="rt-header-left">
          <div className={`rt-dot ${isConnected ? 'rt-dot--on' : 'rt-dot--off'}`} />
          <span className="rt-name">{name ?? code}</span>
          <span className="rt-code">{code}</span>
          {isNxtNo && (
            <span className="rt-nxt-badge">NXT 미지원</span>
          )}
          {!isNxtNo && afterHoursLabel && (
            <span className="rt-afterhours-badge">{afterHoursLabel}</span>
          )}
        </div>
        {latestTrade && (
          <div className="rt-header-right">
            <span className={`rt-current-price ${priceClass}`}>
              {latestTrade.tradePrice.toLocaleString()}원
            </span>
            <span className={`rt-change-rate ${priceClass}`}>
              {latestTrade.changeSign === '1' || latestTrade.changeSign === '2' ? '▲' : '▼'}{' '}
              {Math.abs(latestTrade.changeRate).toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* NXT 미지원 안내 배너 */}
      {isNxtNo && (
        <div className="rt-nxt-notice">
          <span className="rt-nxt-notice-icon">🔒</span>
          <span>넥스트레이드(NXT) 미지원 종목 · 장 마감(15:30) 기준 마지막 데이터</span>
        </div>
      )}

      <div className="rt-body">
        {/* 호가창 */}
        <div className="rt-section">
          <div className="rt-section-title">
            <span>호가창</span>
            {orderBook && (
              <span className="rt-ob-time">
                {isNxtNo ? '15:30 기준' : formatTime(orderBook.timestamp)}
              </span>
            )}
          </div>

          {!orderBook ? (
            <div className="rt-waiting">
              <span className="rt-waiting-dot" /><span className="rt-waiting-dot" /><span className="rt-waiting-dot" />
              <span>데이터 수신 중</span>
            </div>
          ) : (
            <div className="rt-ob-table">
              {/* 매도 잔량 합계 */}
              <div className="rt-ob-total rt-ob-total-ask">
                <span className="rt-ob-total-label">총 매도잔량</span>
                <span className="rt-ob-total-val">
                  {orderBook.totalAskVolume > 0 ? orderBook.totalAskVolume.toLocaleString() : '—'}
                </span>
              </div>

              {/* 매도호가 (level 5 → 1, 가격 높은 순) */}
              {[...askPrices].reverse().map((price, i) => {
                const idx = DISPLAY_LEVELS - 1 - i;
                return (
                  <AskRow
                    key={`ask-${i}`}
                    price={price}
                    volume={askVols[idx] ?? 0}
                    ratio={(askVols[idx] ?? 0) / maxVol}
                  />
                );
              })}

              {/* 스프레드 구분선 */}
              <div className="rt-ob-spread">
                <span className="rt-ob-spread-label">스프레드</span>
                {askPrices[0] != null && bidPrices[0] != null && askPrices[0] > 0 && bidPrices[0] > 0 && (
                  <span className="rt-ob-spread-val">
                    {(askPrices[0] - bidPrices[0]).toLocaleString()}
                  </span>
                )}
              </div>

              {/* 매수호가 (level 1 → 5, 가격 높은 순) */}
              {bidPrices.map((price, i) => (
                <BidRow
                  key={`bid-${i}`}
                  price={price}
                  volume={bidVols[i] ?? 0}
                  ratio={(bidVols[i] ?? 0) / maxVol}
                />
              ))}

              {/* 매수 잔량 합계 */}
              <div className="rt-ob-total rt-ob-total-bid">
                <span className="rt-ob-total-label">총 매수잔량</span>
                <span className="rt-ob-total-val">
                  {orderBook.totalBidVolume > 0 ? orderBook.totalBidVolume.toLocaleString() : '—'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 실시간 체결 */}
        <div className="rt-section rt-section-trades">
          <div className="rt-section-title">
            <span>{isNxtNo ? '마지막 체결' : '실시간 체결'}</span>
            {latestTrade && (
              <span className="rt-trade-acc">
                누적 {latestTrade.accVolume.toLocaleString()}주
              </span>
            )}
          </div>

          {trades.length === 0 ? (
            <div className="rt-waiting">
              <span className="rt-waiting-dot" /><span className="rt-waiting-dot" /><span className="rt-waiting-dot" />
              <span>데이터 수신 중</span>
            </div>
          ) : (
            <div className="rt-trade-list">
              <div className="rt-trade-header">
                <span>시각</span>
                <span>체결가</span>
                <span>수량</span>
                <span>등락</span>
              </div>
              {trades.map((trade, i) => (
                <TradeRow key={i} trade={trade} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
