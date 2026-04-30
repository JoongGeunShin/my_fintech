import { useMemo, useRef, useState } from 'react';
import type { ScreenedStockClient } from '../../hooks/useScreeningFirestore';
import { parsePrice } from '../../hooks/useScreeningFirestore';
import './ScreeningPanel.css';

interface ScreeningPanelProps {
  byLevel: Record<number, ScreenedStockClient[]>;
  topStocks: ScreenedStockClient[];
  otherGroups: Record<string, ScreenedStockClient[]>;
  isLoading: boolean;
  error: string | null;
  selectedCode?: string | null;
  onStockSelect?: (code: string, name: string) => void;
}

const LEVEL_CONFIG = {
  3: { label: 'LEVEL 3', sublabel: '필수 + 보조 + 세부', color: '#00ff9d', bg: 'rgba(0,255,157,0.08)',   border: 'rgba(0,255,157,0.3)' },
  2: { label: 'LEVEL 2', sublabel: '필수 + 보조',         color: '#00c8ff', bg: 'rgba(0,200,255,0.08)',   border: 'rgba(0,200,255,0.3)' },
} as const;

const GROUP_COLOR   = '#f5a623';
const GROUP_BG      = 'rgba(245,166,35,0.08)';
const GROUP_BORDER  = 'rgba(245,166,35,0.3)';

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
  isSelected,
  onSelect,
  showConditions,
}: {
  stock: ScreenedStockClient;
  rank: number;
  searchQuery: string;
  isSelected: boolean;
  onSelect: () => void;
  showConditions?: boolean;
}) {
  const changeRate = parseFloat(stock.changeRate);
  const isPositive = changeRate >= 0;
  const price      = parsePrice(stock.price);

  return (
    <div
      className={`sp-stock-row ${isSelected ? 'sp-stock-row--selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <span className="sp-rank">{rank}</span>
      <div className="sp-stock-info">
        <span className="sp-stock-name">
          <Highlight text={stock.name} query={searchQuery} />
        </span>
        {showConditions && stock.passedSequenceInfos && (
          <span className="sp-condition-names">
            {stock.passedSequenceInfos.map((info) => info.conditionName).join(' · ')}
          </span>
        )}
      </div>
      <div className="sp-stock-metrics">
        <span className="sp-price">{price.toLocaleString('ko-KR')}원</span>
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
  selectedCode,
  onStockSelect,
}: {
  level: number;
  stocks: ScreenedStockClient[];
  searchQuery: string;
  selectedCode?: string | null;
  onStockSelect?: (code: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const cfg = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG];
  if (!cfg) return null;

  const filtered = searchQuery
    ? stocks.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : stocks;

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
              {filtered.slice(0, 30).map((stock, i) => (
                <StockRow
                  key={stock.code}
                  stock={stock}
                  rank={i + 1}
                  searchQuery={searchQuery}
                  isSelected={selectedCode === stock.code}
                  onSelect={() => onStockSelect?.(stock.code, stock.name)}
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

function GroupSection({
  groupName,
  stocks,
  searchQuery,
  selectedCode,
  onStockSelect,
}: {
  groupName: string;
  stocks: ScreenedStockClient[];
  searchQuery: string;
  selectedCode?: string | null;
  onStockSelect?: (code: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const filtered = searchQuery
    ? stocks.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : stocks;

  if (searchQuery && filtered.length === 0) return null;

  return (
    <div
      className="sp-level-section"
      style={{
        '--level-color':  GROUP_COLOR,
        '--level-bg':     GROUP_BG,
        '--level-border': GROUP_BORDER,
      } as React.CSSProperties}
    >
      <button className="sp-level-header" onClick={() => setExpanded((e) => !e)}>
        <div className="sp-level-title">
          <span className="sp-level-dot" />
          <span className="sp-level-name">{groupName}</span>
          <span className="sp-level-sub">조건 검색 그룹</span>
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
            <div className="sp-level-empty">해당 그룹의 종목이 없습니다</div>
          ) : (
            <>
              {filtered.slice(0, 30).map((stock, i) => (
                <StockRow
                  key={stock.code}
                  stock={stock}
                  rank={i + 1}
                  searchQuery={searchQuery}
                  isSelected={selectedCode === stock.code}
                  onSelect={() => onStockSelect?.(stock.code, stock.name)}
                  showConditions
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
  otherGroups,
  isLoading,
  error,
  selectedCode,
  onStockSelect,
}: ScreeningPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const levels = [3, 2] as const;
  const groupNames = Object.keys(otherGroups);

  const allStocks = useMemo(() => [
    ...topStocks,
    ...groupNames.flatMap((g) => otherGroups[g] ?? []),
  ], [topStocks, otherGroups, groupNames]);

  const searchResultCount = useMemo(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    return allStocks.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    ).length;
  }, [searchQuery, allStocks]);

  const hasAnyData = topStocks.length > 0 || groupNames.some((g) => (otherGroups[g]?.length ?? 0) > 0);

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
              <span className="sp-stat-label">my_fintech</span>
            </div>
            {groupNames.map((g) => (
              <div key={g} className="sp-stat" style={{ '--level-color': GROUP_COLOR } as React.CSSProperties}>
                <div className="sp-stat-divider" />
                <span className="sp-stat-value" style={{ color: GROUP_COLOR }}>
                  {otherGroups[g]?.length ?? 0}
                </span>
                <span className="sp-stat-label">{g}</span>
              </div>
            ))}
            {selectedCode && (
              <>
                <div className="sp-stat-divider" />
                <div className="sp-stat">
                  <span className="sp-stat-value sp-selected-indicator">{selectedCode}</span>
                  <span className="sp-stat-label">선택 종목</span>
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
      {!isLoading && !error && !hasAnyData && (
        <div className="sp-empty">
          <p>스크리닝 데이터가 없습니다.</p>
          <p className="sp-empty-hint">서버 스크리닝 실행 후 자동으로 표시됩니다.</p>
        </div>
      )}

      {/* 레벨별 + 기타 그룹 섹션 */}
      {!isLoading && hasAnyData && (
        <div className="sp-content">
          {levels.map((level) => (
            <LevelSection
              key={level}
              level={level}
              stocks={byLevel[level] ?? []}
              searchQuery={searchQuery}
              selectedCode={selectedCode}
              onStockSelect={onStockSelect}
            />
          ))}
          {groupNames.map((groupName) => (
            <GroupSection
              key={groupName}
              groupName={groupName}
              stocks={otherGroups[groupName] ?? []}
              searchQuery={searchQuery}
              selectedCode={selectedCode}
              onStockSelect={onStockSelect}
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
