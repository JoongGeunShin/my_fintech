import type { Timestamp } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import type { ScreenedStockClient, ScreeningRun } from '../../hooks/useScreeningFirestore';
import './ScreeningPanel.css';

interface ScreeningPanelProps {
  byLevel: Record<number, ScreenedStockClient[]>;
  topStocks: ScreenedStockClient[];
  lastRun: ScreeningRun | null;
  isLoading: boolean;
  error: string | null;
}

const LEVEL_CONFIG = {
  3: { label: 'LEVEL 3', sublabel: '필수 + 보조 + 세부', color: '#00ff9d', bg: 'rgba(0,255,157,0.08)', border: 'rgba(0,255,157,0.3)' },
  2: { label: 'LEVEL 2', sublabel: '필수 + 보조',       color: '#00c8ff', bg: 'rgba(0,200,255,0.08)', border: 'rgba(0,200,255,0.3)' },
  1: { label: 'LEVEL 1', sublabel: '필수 통과',          color: '#aa3bff', bg: 'rgba(170,59,255,0.08)', border: 'rgba(170,59,255,0.3)' },
} as const;

function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  try {
    return ts.toDate().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '—'; }
}

function StockRow({ stock, rank }: { stock: ScreenedStockClient; rank: number }) {
  const changeRate = parseFloat(stock.changeRate);
  const isPositive = changeRate >= 0;
  const price = Number(stock.price);

  return (
    <div className="sp-stock-row">
      <span className="sp-rank">#{rank}</span>
      <div className="sp-stock-info">
        <span className="sp-stock-name">{stock.name}</span>
        <span className="sp-stock-code">{stock.code}</span>
      </div>
      <div className="sp-stock-metrics">
        <span className="sp-price">{isNaN(price) ? stock.price : price.toLocaleString('ko-KR')}원</span>
        <span className={`sp-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '▲' : '▼'} {Math.abs(changeRate).toFixed(2)}%
        </span>
      </div>
      <div className="sp-sequences">
        {stock.passedSequences.slice(0, 5).map((seq) => (
          <span key={seq} className="sp-seq-badge">{seq}</span>
        ))}
        {stock.passedSequences.length > 5 && (
          <span className="sp-seq-more">+{stock.passedSequences.length - 5}</span>
        )}
      </div>
      <span className="sp-score-badge">S{stock.score}</span>
    </div>
  );
}

function LevelSection({ level, stocks }: { level: number; stocks: ScreenedStockClient[] }) {
  const [expanded, setExpanded] = useState(true);
  const cfg = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG];
  if (!cfg) return null;

  return (
    <div
      className="sp-level-section"
      style={{ '--level-color': cfg.color, '--level-bg': cfg.bg, '--level-border': cfg.border } as React.CSSProperties}
    >
      <button className="sp-level-header" onClick={() => setExpanded((e) => !e)}>
        <div className="sp-level-title">
          <span className="sp-level-dot" />
          <span className="sp-level-name">{cfg.label}</span>
          <span className="sp-level-sub">{cfg.sublabel}</span>
        </div>
        <div className="sp-level-meta">
          <span className="sp-level-count">{stocks.length}종목</span>
          <span className="sp-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (
        <div className="sp-level-body">
          {stocks.length === 0 ? (
            <div className="sp-level-empty">해당 레벨의 종목이 없습니다</div>
          ) : (
            <>
              <div className="sp-table-header">
                <span>순위</span><span>종목</span><span>가격 / 등락</span><span>통과 조건</span><span>레벨</span>
              </div>
              {stocks.slice(0, 20).map((stock, i) => (
                <StockRow key={stock.code} stock={stock} rank={i + 1} />
              ))}
              {stocks.length > 20 && (
                <div className="sp-more-hint">+{stocks.length - 20}개 종목 더 있음</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScreeningPanel({ byLevel, topStocks, lastRun, isLoading, error }: ScreeningPanelProps) {
  const [pulse, setPulse] = useState(false);
  const prevRunAt = useRef<number | null>(null);

  useEffect(() => {
    if (!lastRun?.runAt) return;
    const ts = lastRun.runAt.seconds;
    if (ts === prevRunAt.current) return;
    prevRunAt.current = ts;
    const onTimer = setTimeout(() => setPulse(true), 0);
    const offTimer = setTimeout(() => setPulse(false), 1200);
    return () => {
      clearTimeout(onTimer);
      clearTimeout(offTimer);
    };
  }, [lastRun]);

  const levels = [3, 2, 1] as const;

  return (
    <section className="screening-panel">
      <div className="sp-header">
        <div className="sp-header-left">
          <div className={`sp-status-dot ${isLoading ? 'loading' : error ? 'offline' : 'online'}`} />
          <h2 className="sp-title">조건 스크리닝</h2>
          <span className="sp-subtitle">Firebase 실시간 구독</span>
        </div>
        <div className="sp-header-right">
          <div className="sp-stats">
            <div className="sp-stat">
              <span className="sp-stat-value">{topStocks.length}</span>
              <span className="sp-stat-label">통과 종목</span>
            </div>
            <div className="sp-stat-divider" />
            <div className="sp-stat">
              <span className={`sp-stat-value ${pulse ? 'sp-pulse-value' : ''}`}>
                {formatTimestamp(lastRun?.runAt)}
              </span>
              <span className="sp-stat-label">최근 갱신</span>
            </div>
            {lastRun && (
              <>
                <div className="sp-stat-divider" />
                <div className="sp-stat">
                  <span className="sp-stat-value">{(lastRun.durationMs / 1000).toFixed(1)}s</span>
                  <span className="sp-stat-label">소요 시간</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <div className="sp-error"><span>⚠ {error}</span></div>}

      {isLoading && !error && (
        <div className="sp-connecting">
          <div className="sp-connecting-dots"><span /><span /><span /></div>
          <p>Firestore에서 데이터 로드 중...</p>
        </div>
      )}

      {!isLoading && !error && topStocks.length === 0 && (
        <div className="sp-empty">
          <p>스크리닝 데이터가 없습니다.</p>
          <p className="sp-empty-hint">서버 스크리닝 실행 후 자동으로 표시됩니다.</p>
        </div>
      )}

      {!isLoading && (
        <div className="sp-content">
          {levels.map((level) => (
            <LevelSection key={level} level={level} stocks={byLevel[level] ?? []} />
          ))}
        </div>
      )}
    </section>
  );
}
