import { Link } from 'react-router-dom';
import { useTradingEngine, type VirtualPosition, type VirtualTrade, type TopSignal } from '../../hooks/useTradingEngine';
import './Trading.css';

// ── 포맷 유틸 ─────────────────────────────────────────────────

function fmtKRW(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function fmtPct(n: number) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const REASON_LABEL: Record<string, string> = {
  SIGNAL_BUY:       '신호 매수',
  TAKE_PROFIT:      '익절',
  STOP_LOSS:        '손절',
  TIME_STOP:        '타임스탑',
  ENHANCED_PROFIT:  '고수익 익절',
  MANUAL:           '수동',
};

// ── 서브 컴포넌트들 ─────────────────────────────────────────────

function PositionCard({ pos }: { pos: VirtualPosition | null }) {
  if (!pos) {
    return (
      <div className="td-card">
        <div className="td-card-title">현재 포지션</div>
        <div className="td-position-empty">보유 포지션 없음</div>
      </div>
    );
  }

  const rate = pos.unrealizedPnLRate;
  const pnlClass = rate > 0 ? 'pos' : rate < 0 ? 'neg' : 'zero';

  return (
    <div className="td-card">
      <div className="td-card-title">현재 포지션</div>
      <div className="td-position-info">
        <div>
          <span className="td-pos-name">{pos.name}</span>
          <span className="td-pos-code">{pos.code}</span>
        </div>

        <div className="td-pos-pnl-row">
          <span className={`td-pos-pnl ${pnlClass}`}>
            {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
          </span>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>
            ({rate > 0 ? '+' : ''}{fmtKRW(pos.unrealizedPnL)})
          </span>
        </div>

        <div className="td-pos-prices">
          <div className="td-pos-price-item">
            <span className="td-pos-price-label">진입가</span>
            <span className="td-pos-price-val">{pos.entryPrice.toLocaleString()}</span>
          </div>
          <div className="td-pos-price-item">
            <span className="td-pos-price-label">현재가</span>
            <span className="td-pos-price-val">{pos.currentPrice.toLocaleString()}</span>
          </div>
          <div className="td-pos-price-item">
            <span className="td-pos-price-label">수량</span>
            <span className="td-pos-price-val">{pos.quantity.toLocaleString()}주</span>
          </div>
        </div>

        <div className="td-pos-stops">
          <div className="td-pos-stop-item">
            <span className="td-pos-stop-label">손절</span>
            <span className="td-pos-stop-val sl">{pos.stopLossPrice.toLocaleString()}</span>
          </div>
          <div className="td-pos-stop-item">
            <span className="td-pos-stop-label">익절</span>
            <span className="td-pos-stop-val tp">{pos.takeProfitPrice.toLocaleString()}</span>
          </div>
          <div className="td-pos-stop-item">
            <span className="td-pos-stop-label">진입점수</span>
            <span className="td-pos-stop-val sl" style={{ color: 'var(--accent)' }}>
              {pos.scoreAtEntry.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalsCard({ signals, count }: { signals: TopSignal[]; count: number }) {
  return (
    <div className="td-card">
      <div className="td-card-title">모니터링 신호 (상위 5 / 총 {count}종목)</div>
      {signals.length === 0 ? (
        <div className="td-empty">모니터링 중인 종목이 없습니다</div>
      ) : (
        <table className="td-signals-table">
          <thead>
            <tr>
              <th>종목</th>
              <th>신호</th>
              <th style={{ minWidth: 100 }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => {
              const pct  = ((s.score + 1) / 2) * 100; // -1~+1 → 0~100%
              const color = s.score > 0.3 ? '#22c55e' : s.score < -0.3 ? '#ef4444' : '#9ca3af';
              return (
                <tr key={s.code}>
                  <td>
                    <span style={{ fontWeight: 600, color: 'var(--text-h)' }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text)', marginLeft: 4 }}>{s.code}</span>
                  </td>
                  <td>
                    <span className={`td-signal-badge ${s.signal}`}>{s.signal}</span>
                  </td>
                  <td>
                    <div className="td-score-bar-wrap">
                      <div className="td-score-bar-bg">
                        <div
                          className="td-score-bar-fill"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                      <span style={{ fontSize: 12, color, fontWeight: 700, minWidth: 36 }}>
                        {s.score > 0 ? '+' : ''}{s.score.toFixed(2)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TradesCard({ trades }: { trades: VirtualTrade[] }) {
  return (
    <div className="td-card">
      <div className="td-card-title">최근 거래 내역</div>
      {trades.length === 0 ? (
        <div className="td-empty">거래 내역이 없습니다</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="td-trades-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>종목</th>
                <th>구분</th>
                <th style={{ textAlign: 'right' }}>가격</th>
                <th style={{ textAlign: 'right' }}>수량</th>
                <th style={{ textAlign: 'right' }}>손익</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12, color: 'var(--text)' }}>{fmtTime(t.executedAt)}</td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text)', marginLeft: 4 }}>{t.code}</span>
                  </td>
                  <td>
                    <span className={t.side === 'BUY' ? 'td-side-buy' : 'td-side-sell'}>
                      {t.side === 'BUY' ? '매수' : '매도'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{t.price.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{t.quantity.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    {t.realizedPnL !== undefined ? (
                      <span style={{ color: t.realizedPnL >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                        {t.realizedPnL >= 0 ? '+' : ''}{fmtPct(t.pnlRate ?? 0)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text)' }}>—</span>
                    )}
                  </td>
                  <td>
                    <span className="td-reason-badge">
                      {REASON_LABEL[t.reason] ?? t.reason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────

export default function TradingPage() {
  const { status, trades, isConnected, halted, actionLoading, start, stop, reset } =
    useTradingEngine();

  const pf       = status?.portfolio;
  const running  = status?.isRunning ?? false;
  const winRate  = pf && pf.totalTrades > 0
    ? ((pf.winTrades / pf.totalTrades) * 100).toFixed(1)
    : '—';

  return (
    <div className="td-root">
      {/* ── 헤더 ─────────────────────────────────────────────── */}
      <header className="td-header">
        <Link to="/" className="td-back-btn">← 홈</Link>

        <h1 className="td-title">
          {running && <span className="td-running-dot" />}
          자동매매 대시보드
        </h1>

        <div className="td-conn-badge">
          <span className={`td-conn-dot ${isConnected ? 'on' : 'off'}`} />
          {isConnected ? '연결됨' : '연결 끊김'}
        </div>

        <div className="td-controls">
          <button
            className="td-btn start"
            onClick={start}
            disabled={running || actionLoading}
          >
            시작
          </button>
          <button
            className="td-btn stop"
            onClick={stop}
            disabled={!running || actionLoading}
          >
            중지
          </button>
          <button
            className="td-btn reset"
            onClick={reset}
            disabled={actionLoading}
          >
            초기화
          </button>
        </div>
      </header>

      {/* ── 본문 ─────────────────────────────────────────────── */}
      <main className="td-body">

        {/* 중단 알림 */}
        {halted && (
          <div className="td-banner halted">
            ⚠ 금일 손실 발생으로 자동매매가 중단되었습니다.
            (금일 손익: {fmtKRW(halted.dailyPnL)}) — 초기화 또는 내일 다시 시작하세요.
          </div>
        )}

        {/* 포트폴리오 + 포지션 */}
        <div className="td-top-row">
          <div className="td-card">
            <div className="td-card-title">포트폴리오</div>
            {pf ? (
              <div className="td-portfolio-grid">
                <div className="td-pf-item">
                  <span className="td-pf-label">가용 잔고</span>
                  <span className="td-pf-value">{fmtKRW(pf.balance)}</span>
                </div>
                <div className="td-pf-item">
                  <span className="td-pf-label">금일 손익</span>
                  <span className={`td-pf-value ${pf.dailyPnL > 0 ? 'pos' : pf.dailyPnL < 0 ? 'neg' : 'neutral'}`}>
                    {pf.dailyPnL > 0 ? '+' : ''}{fmtKRW(pf.dailyPnL)}
                  </span>
                </div>
                <div className="td-pf-item">
                  <span className="td-pf-label">총 거래 / 승률</span>
                  <span className="td-pf-value">{pf.totalTrades}회 / {winRate}%</span>
                </div>
                <div className="td-pf-item">
                  <span className="td-pf-label">초기 자본</span>
                  <span className="td-pf-value neutral">{fmtKRW(pf.initialBalance)}</span>
                </div>
              </div>
            ) : (
              <div className="td-empty">—</div>
            )}
          </div>

          <PositionCard pos={status?.position ?? null} />
        </div>

        {/* 신호 */}
        <SignalsCard
          signals={status?.topSignals ?? []}
          count={status?.monitoredStockCount ?? 0}
        />

        {/* 거래 내역 */}
        <TradesCard trades={trades} />
      </main>
    </div>
  );
}
