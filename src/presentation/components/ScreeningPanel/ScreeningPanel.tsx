// src/presentation/components/ScreeningPanel/ScreeningPanel.tsx
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

// 초단기 그룹 (기타 그룹 중 첫 번째 or "초단기" 포함)
const SHORT_COLOR  = '#f5a623';
const SHORT_BG     = 'rgba(245,166,35,0.08)';
const SHORT_BORDER = 'rgba(245,166,35,0.3)';

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

// ── 하나의 랭킹 열 컴포넌트 ──────────────────────────────────
function RankingColumn({
  title,
  sublabel,
  color,
  bg,
  border,
  stocks,
  searchQuery,
  selectedCode,
  onStockSelect,
  maxRows = 10,
  showConditions,
}: {
  title: string;
  sublabel: string;
  color: string;
  bg: string;
  border: string;
  stocks: ScreenedStockClient[];
  searchQuery: string;
  selectedCode?: string | null;
  onStockSelect?: (code: string, name: string) => void;
  maxRows?: number;
  showConditions?: boolean;
}) {
  const filtered = searchQuery
    ? stocks.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : stocks;

  return (
    <div
      className="sp-ranking-col"
      style={{ '--col-color': color, '--col-bg': bg, '--col-border': border } as React.CSSProperties}
    >
      {/* 헤더 */}
      <div className="sp-col-header">
        <div className="sp-col-header-left">
          <span className="sp-col-dot" />
          <div>
            <div className="sp-col-title">{title}</div>
            <div className="sp-col-sub">{sublabel}</div>
          </div>
        </div>
        <span className="sp-col-count">{filtered.length}종목</span>
      </div>

      {/* 목록 */}
      <div className="sp-col-body">
        {filtered.length === 0 ? (
          <div className="sp-col-empty">해당하는 종목이 없습니다</div>
        ) : (
          filtered.slice(0, maxRows).map((stock, i) => (
            <StockRow
              key={stock.code}
              stock={stock}
              rank={i + 1}
              searchQuery={searchQuery}
              isSelected={selectedCode === stock.code}
              onSelect={() => onStockSelect?.(stock.code, stock.name)}
              showConditions={showConditions}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── 메인 패널 ────────────────────────────────────────────────
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

  // 초단기 그룹 결정
  const shortTermKey = useMemo(() =>
    Object.keys(otherGroups).find((k) =>
      k.includes('초단기') || k.includes('단기') || k.includes('short')
    ) ?? Object.keys(otherGroups)[0]
  , [otherGroups]);

  const shortTermStocks = shortTermKey ? (otherGroups[shortTermKey] ?? []) : topStocks;

  const level3 = byLevel[3] ?? [];
  const level2 = byLevel[2] ?? [];

  // 로딩 상태
  if (isLoading) {
    return (
      <section className="screening-panel sp-loading-state">
        <div className="sp-connecting-dots">
          <span /><span /><span />
        </div>
        <p>스크리닝 데이터 로딩 중...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="screening-panel sp-error-state">
        <p className="sp-error-msg">⚠ {error}</p>
      </section>
    );
  }

  return (
    <section className="screening-panel">
      {/* 검색바 */}
      <div className="sp-search-wrap">
        <input
          ref={searchRef}
          className="sp-search"
          type="text"
          placeholder="종목명·코드 검색"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="sp-search-clear" onClick={() => setSearchQuery('')}>✕</button>
        )}
      </div>

      {/* 3열 랭킹 */}
      <div className="sp-ranking-grid">
        <RankingColumn
          title="LEVEL 3"
          sublabel="필수 + 보조 + 세부"
          color={LEVEL_CONFIG[3].color}
          bg={LEVEL_CONFIG[3].bg}
          border={LEVEL_CONFIG[3].border}
          stocks={level3}
          searchQuery={searchQuery}
          selectedCode={selectedCode}
          onStockSelect={onStockSelect}
          maxRows={10}
        />
        <RankingColumn
          title="LEVEL 2"
          sublabel="필수 + 보조"
          color={LEVEL_CONFIG[2].color}
          bg={LEVEL_CONFIG[2].bg}
          border={LEVEL_CONFIG[2].border}
          stocks={level2}
          searchQuery={searchQuery}
          selectedCode={selectedCode}
          onStockSelect={onStockSelect}
          maxRows={10}
        />
        <RankingColumn
          title={shortTermKey ?? '초단기'}
          sublabel="단기 조건 통과"
          color={SHORT_COLOR}
          bg={SHORT_BG}
          border={SHORT_BORDER}
          stocks={shortTermStocks}
          searchQuery={searchQuery}
          selectedCode={selectedCode}
          onStockSelect={onStockSelect}
          maxRows={10}
          showConditions
        />
      </div>

      {/* 검색 결과가 있을 때 하단에 추가 목록 (선택) */}
      {searchQuery && (
        <div className="sp-search-result-hint">
          전체 검색 결과 표시 중
        </div>
      )}
    </section>
  );
}
