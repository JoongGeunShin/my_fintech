export interface KisStockPeriodSpecifiedResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output1: KisStockPeriodSpecifiedOutput1;  // 종목 현재 상태 (단건)
  output2: KisStockPeriodSpecifiedOutput2[]; // 기간별 OHLCV (리스트)
}

export interface KisStockPeriodSpecifiedOutput1 {
  prdy_vrss: string;             // 전일 대비
  prdy_vrss_sign: string;        // 전일 대비 부호 (1:상한 2:상승 3:보합 4:하한 5:하락)
  prdy_ctrt: string;             // 전일 대비율
  stck_prdy_clpr: string;        // 주식 전일 종가
  acml_vol: string;              // 누적 거래량
  acml_tr_pbmn: string;          // 누적 거래 대금
  hts_kor_isnm: string;          // HTS 한글 종목명
  stck_prpr: string;             // 주식 현재가
  stck_shrn_iscd: string;        // 주식 단축 종목코드
  prdy_vol: string;              // 전일 거래량
  stck_mxpr: string;             // 주식 상한가
  stck_llam: string;             // 주식 하한가
  stck_oprc: string;             // 주식 시가
  stck_hgpr: string;             // 주식 최고가
  stck_lwpr: string;             // 주식 최저가
  stck_prdy_oprc: string;        // 주식 전일 시가
  stck_prdy_hgpr: string;        // 주식 전일 최고가
  stck_prdy_lwpr: string;        // 주식 전일 최저가
  askp: string;                  // 매도 호가
  bidp: string;                  // 매수 호가
  prdy_vrss_vol: string;         // 전일 대비 거래량
  vol_tnrt: string;              // 거래량 회전율
  stck_fcam: string;             // 주식 액면가
  lstn_stcn: string;             // 상장 주수
  cpfn: string;                  // 자본금
  hts_avls: string;              // HTS 시가총액
  per: string;                   // PER
  eps: string;                   // EPS
  pbr: string;                   // PBR
  itewhol_loan_rmnd_ratem: string; // 전체 융자 잔고 비율
}

export interface KisStockPeriodSpecifiedOutput2 {
  stck_bsop_date: string;        // 주식 영업 일자 (YYYYMMDD)
  stck_clpr: string;             // 주식 종가
  stck_oprc: string;             // 주식 시가
  stck_hgpr: string;             // 주식 최고가
  stck_lwpr: string;             // 주식 최저가
  acml_vol: string;              // 누적 거래량
  acml_tr_pbmn: string;          // 누적 거래 대금
  flng_cls_code: string;         // 락 구분 코드 (00:해당없음 01:권리락 02:배당락 03:분배락 04:권배락 05:중간배당락 06:권리·중간배당락 07:유상증자락)
  prtt_rate: string;             // 분할 비율
  mod_yn: string;                // 변경 여부 (Y/N)
  prdy_vrss_sign: string;        // 전일 대비 부호 (1:상한 2:상승 3:보합 4:하한 5:하락)
  prdy_vrss: string;             // 전일 대비
  revl_issu_reas: string;        // 재평가 사유 코드
}

export interface StockPeriodPriceSpecified {
  code: string;                        // 종목 코드
  name: string;                        // 종목명
  summary: StockSummarySpecified;      // 현재 종목 요약 정보
  dailyPrices: PeriodPriceSpecified[]; // 가공된 기간별 데이터 배열
}

export interface StockSummarySpecified {
  currentPrice: number;      // 현재가
  change: number;            // 전일 대비
  changeRate: number;        // 전일 대비율 (%)
  changeSign: string;        // 전일 대비 부호
  prevClosePrice: number;    // 전일 종가
  openPrice: number;         // 시가
  highPrice: number;         // 최고가
  lowPrice: number;          // 최저가
  prevOpenPrice: number;     // 전일 시가
  prevHighPrice: number;     // 전일 최고가
  prevLowPrice: number;      // 전일 최저가
  volume: number;            // 누적 거래량
  tradingValue: number;      // 누적 거래 대금
  prevVolume: number;        // 전일 거래량
  upperLimit: number;        // 상한가
  lowerLimit: number;        // 하한가
  askPrice: number;          // 매도 호가
  bidPrice: number;          // 매수 호가
  marketCap: number;         // 시가총액
  faceValue: number;         // 액면가
  listedShares: number;      // 상장 주수
  capital: number;           // 자본금
  per: number;               // PER
  eps: number;               // EPS
  pbr: number;               // PBR
  volumeTurnoverRate: number; // 거래량 회전율
  loanRemainRate: number;    // 전체 융자 잔고 비율
}

export interface PeriodPriceSpecified {
  date: string;              // 날짜 (YYYYMMDD)
  closePrice: number;        // 종가
  openPrice: number;         // 시가
  highPrice: number;         // 고가
  lowPrice: number;          // 저가
  volume: number;            // 거래량
  tradingValue: number;      // 거래 대금
  change: number;            // 전일 대비
  changeSign: string;        // 전일 대비 부호
  isSplit: boolean;          // 분할 여부 (mod_yn)
  splitRatio: number;        // 분할 비율
  exDividendType: string;    // 락 구분 코드 (flng_cls_code)
}