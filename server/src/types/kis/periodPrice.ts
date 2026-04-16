export interface KisStockPeriodOutput {
  stck_bsop_date: string;    // 주식 영업 일자
  stck_clpr: string;         // 주식 종가
  stck_oprc: string;         // 주식 시가
  stck_hgpr: string;         // 주식 최고가
  stck_lwpr: string;         // 주식 최저가
  acml_vol: string;          // 누적 거래량
  prdy_vrss: string;         // 전일 대비
  prdy_vrss_sign: string;    // 전일 대비 부호
  prdy_ctrt: string;         // 전일 대비율
  hts_frgn_ehrt: string;     // HTS 외국인 소진율
  frgn_ntby_qty: string;     // 외국인 순매수 수량
  acml_prtt_rate: string;    // 누적 분할 비율
}

export interface KisStockPeriodResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output: KisStockPeriodOutput[]; // 리스트 형태로 데이터가 옴
}

export interface StockPeriodPrice {
  code: string;               // 종목 코드
  dailyPrices: PeriodPrice[]; // 가공된 일별 데이터 배열
}

export interface PeriodPrice {
  date: string;          // 날짜 (YYYYMMDD)
  closePrice: number;    // 종가
  openPrice: number;     // 시가
  highPrice: number;     // 고가
  lowPrice: number;      // 저가
  volume: number;        // 거래량
  change: number;        // 전일 대비
  changeRate: number;    // 등락률
}