import type { Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenedStockClient, ScreeningRun } from '../../hooks/useScreeningFirestore';
import { parsePrice } from '../../hooks/useScreeningFirestore';
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
  2: { label: 'LEVEL 2', sublabel: '필수 + 보조',        color: '#00c8ff', bg: 'rgba(0,200,255,0.08)', border: 'rgba(0,200,255,0.3)' },
  1: { label: 'LEVEL 1', sublabel: '필수 통과',           color: '#aa3bff', bg: 'rgba(170,59,255,0.08)', border: 'rgba(170,59,255,0.3)' },
} as const;

function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  try {
    return ts.toDate().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '—'; }
}

// 검색어 하이라이트
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="sp-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function StockRow({
  stock,
  rank,
  searchQuery,
}: {
  stock: ScreenedStockClient;
  rank: number;
  searchQuery: string;
}) {
  const changeRate = parseFloat(stock.changeRate);
  const isPositive = changeRate >= 0;
  const price = parsePrice(stock.price);

  return (
    <div className="sp-stock-row">
      {/* 1열: 순위 */}
      <span className="sp-rank">{rank}</span>

      {/* 2열: 종목명 */}
      <div className="sp-stock-info">
        <span className="sp-stock-name">
          <Highlight text={stock.name} query={searchQuery} />
        </span>
      </div>

      {/* 3열: 가격 및 등락률 (우측 정렬) */}
      <div className="sp-stock-metrics">
        <span className="sp-price">
          {price.toLocaleString('ko-KR')}원
        </span>
        <span className={`sp-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '▲' : '▼'} {Math.abs(changeRate).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

function LevelSection({
  level,
  stocks,
  searchQuery,
}: {
  level: number;
  stocks: ScreenedStockClient[];
  searchQuery: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const cfg = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG];
  if (!cfg) return null;

  // 검색어가 있으면 필터링
  const filtered = searchQuery
    ? stocks.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : stocks;

  // 검색 결과 없으면 섹션 숨김
  if (searchQuery && filtered.length === 0) return null;

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
          <span className="sp-level-count">
            {searchQuery ? `${filtered.length} / ${stocks.length}` : `${stocks.length}`}종목
          </span>
          <span className="sp-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="sp-level-body">
          {filtered.length === 0 ? (
            <div className="sp-level-empty">해당 레벨의 종목이 없습니다</div>
          ) : (
            <>
              <div className="sp-table-header">
                <span>순위</span>
                <span>종목명 / 코드</span>
                <span>현재가 / 등락</span>
                <span>52주 고/저</span>
                <span>통과 조건</span>
                <span>레벨</span>
              </div>
              {filtered.slice(0, 30).map((stock, i) => (
                <StockRow
                  key={stock.code}
                  stock={stock}
                  rank={i + 1}
                  searchQuery={searchQuery}
                />
              ))}
              {filtered.length > 30 && (
                <div className="sp-more-hint">+{filtered.length - 30}개 종목 더 있음</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScreeningPanel({
  byLevel,
  topStocks,
  lastRun,
  isLoading,
  error,
}: ScreeningPanelProps) {
  const [pulse, setPulse] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const prevRunAt = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lastRun?.runAt) return;
    const ts = lastRun.runAt.seconds;
    if (ts === prevRunAt.current) return;
    prevRunAt.current = ts;
    const onTimer = setTimeout(() => setPulse(true), 0);
    const offTimer = setTimeout(() => setPulse(false), 1200);
    return () => { clearTimeout(onTimer); clearTimeout(offTimer); };
  }, [lastRun]);

  const levels = [3, 2, 1] as const;

  // 검색 시 전체 결과 수
  const searchResultCount = useMemo(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    return topStocks.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    ).length;
  }, [searchQuery, topStocks]);

  return (
    <section className="screening-panel">
      {/* 헤더 */}
      <div className="sp-header">
        <div className="sp-header-left">
          <div className={`sp-status-dot ${isLoading ? 'loading' : error ? 'offline' : 'online'}`} />
          <h2 className="sp-title">조건 스크리닝</h2>
          <span className="sp-subtitle">Firebase 실시간</span>
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

      {/* 검색 바 */}
      <div className="sp-search-bar">
        <div className="sp-search-inner">
          <span className="sp-search-icon">⌕</span>
          <input
            ref={searchRef}
            className="sp-search-input"
            type="text"
            placeholder="종목명 또는 종목코드로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="sp-search-clear" onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}>
              ✕
            </button>
          )}
        </div>
        {searchQuery && (
          <span className="sp-search-result-count">
            {searchResultCount === 0 ? '결과 없음' : `${searchResultCount}개 종목 검색됨`}
          </span>
        )}
      </div>

      {/* 에러 */}
      {error && <div className="sp-error"><span>⚠ {error}</span></div>}

      {/* 로딩 */}
      {isLoading && !error && (
        <div className="sp-connecting">
          <div className="sp-connecting-dots"><span /><span /><span /></div>
          <p>Firestore에서 데이터 로드 중...</p>
        </div>
      )}

      {/* 데이터 없음 */}
      {!isLoading && !error && topStocks.length === 0 && (
        <div className="sp-empty">
          <p>스크리닝 데이터가 없습니다.</p>
          <p className="sp-empty-hint">서버 스크리닝 실행 후 자동으로 표시됩니다.</p>
        </div>
      )}

      {/* 레벨별 섹션 */}
      {!isLoading && topStocks.length > 0 && (
        <div className="sp-content">
          {levels.map((level) => (
            <LevelSection
              key={level}
              level={level}
              stocks={byLevel[level] ?? []}
              searchQuery={searchQuery}
            />
          ))}
          {searchQuery && searchResultCount === 0 && (
            <div className="sp-empty">
              <p>"{searchQuery}"에 해당하는 종목이 없습니다.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
