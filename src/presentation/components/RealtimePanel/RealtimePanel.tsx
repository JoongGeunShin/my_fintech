import type { RealtimeOrderBook, RealtimeTrade } from '../../hooks/useRealtimeStock';
import './RealtimePanel.css';

interface RealtimePanelProps {
  code: string | null;
  name?: string;
  orderBook: RealtimeOrderBook | null;
  trades: RealtimeTrade[];
  latestTrade: RealtimeTrade | null;
  isConnected: boolean;
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
      <span className="rt-ob-vol">{volume.toLocaleString()}</span>
      <VolumeBar ratio={ratio} side="ask" />
      <span className="rt-ob-price">{price.toLocaleString()}</span>
    </div>
  );
}

function BidRow({ price, volume, ratio }: { price: number; volume: number; ratio: number }) {
  return (
    <div className="rt-ob-row rt-ob-bid">
      <span className="rt-ob-price">{price.toLocaleString()}</span>
      <VolumeBar ratio={ratio} side="bid" />
      <span className="rt-ob-vol">{volume.toLocaleString()}</span>
    </div>
  );
}

function TradeRow({ trade }: { trade: RealtimeTrade }) {
  const isUp   = trade.changeSign === '1' || trade.changeSign === '2';
  const isDown = trade.changeSign === '4' || trade.changeSign === '5';
  const dir    = isUp ? '▲' : isDown ? '▼' : '─';
  const cls    = isUp ? 'rt-up' : isDown ? 'rt-down' : '';

  return (
    <div className="rt-trade-row">
      <span className="rt-trade-time">{formatTime(trade.timestamp)}</span>
      <span className={`rt-trade-price ${cls}`}>{trade.tradePrice.toLocaleString()}</span>
      <span className="rt-trade-vol">{trade.tradeVolume.toLocaleString()}</span>
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

  // 최대 볼륨 계산 (바 크기 기준)
  const askVols = orderBook?.askVolumes.slice(0, DISPLAY_LEVELS) ?? [];
  const bidVols = orderBook?.bidVolumes.slice(0, DISPLAY_LEVELS) ?? [];
  const maxVol  = Math.max(...askVols, ...bidVols, 1);

  const askPrices  = orderBook?.askPrices.slice(0, DISPLAY_LEVELS) ?? [];
  const bidPrices  = orderBook?.bidPrices.slice(0, DISPLAY_LEVELS) ?? [];

  const isUp   = latestTrade?.changeSign === '1' || latestTrade?.changeSign === '2';
  const isDown = latestTrade?.changeSign === '4' || latestTrade?.changeSign === '5';
  const priceClass = isUp ? 'rt-up' : isDown ? 'rt-down' : '';

  return (
    <section className="realtime-panel">
      {/* 헤더 */}
      <div className="rt-header">
        <div className="rt-header-left">
          <div className={`rt-dot ${isConnected ? 'rt-dot--on' : 'rt-dot--off'}`} />
          <span className="rt-name">{name ?? code}</span>
          <span className="rt-code">{code}</span>
        </div>
        {latestTrade && (
          <div className="rt-header-right">
            <span className={`rt-current-price ${priceClass}`}>
              {latestTrade.tradePrice.toLocaleString()}원
            </span>
            <span className={`rt-change-rate ${priceClass}`}>
              {latestTrade.changeRate >= 0 ? '▲' : '▼'} {Math.abs(latestTrade.changeRate).toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      <div className="rt-body">
        {/* 호가창 */}
        <div className="rt-section">
          <div className="rt-section-title">
            <span>호가창</span>
            {orderBook && (
              <span className="rt-ob-time">{formatTime(orderBook.timestamp)}</span>
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
                <span className="rt-ob-total-val">{orderBook.totalAskVolume.toLocaleString()}</span>
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
                {askPrices[0] && bidPrices[0] && (
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
                <span className="rt-ob-total-val">{orderBook.totalBidVolume.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* 실시간 체결 */}
        <div className="rt-section rt-section-trades">
          <div className="rt-section-title">
            <span>실시간 체결</span>
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
