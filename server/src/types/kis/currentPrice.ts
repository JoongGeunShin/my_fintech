export interface KisStockPriceOutput {
  iscd_stat_cls_code: string;  // 종목 상태 구분 코드
  marg_rate: string;           // 증거금 비율
  rprs_mrkt_kor_name: string;  // 대표 시장 한글명
  new_hgpr_lwpr_cls_code: string;
  bstp_kor_isnm: string;       // 업종 한글 종목명
  temp_stop_yn: string;        // 임시 정지 여부
  oprc_rang_cont_yn: string;
  clpr_rang_cont_yn: string;
  crdt_able_yn: string;        // 신용 가능 여부
  grmn_rate_cls_code: string;
  elw_pblc_yn: string;
  stck_prpr: string;           // 주식 현재가
  prdy_vrss: string;           // 전일 대비
  prdy_vrss_sign: string;      // 전일 대비 부호 (1:상한 2:상승 3:보합 4:하락 5:하한)
  prdy_ctrt: string;           // 전일 대비율
  acml_vol: string;            // 누적 거래량
  acml_tr_pbmn: string;        // 누적 거래대금
  hts_kor_isnm: string;        // HTS 한글 종목명
  stck_mxpr: string;           // 주식 상한가
  stck_llam: string;           // 주식 하한가
  stck_oprc: string;           // 주식 시가
  stck_hgpr: string;           // 주식 최고가
  stck_lwpr: string;           // 주식 최저가
  stck_prdy_clpr: string;      // 주식 전일 종가
  askp: string;                // 매도호가
  bidp: string;                // 매수호가
  prdy_vol: string;            // 전일 거래량
  stck_shrn_iscd: string;      // 주식 단축 종목코드
  vi_cls_code: string;         // VI 적용 구분 코드
  ovtm_vi_cls_code: string;
  last_ssts_cntg_qty: string;
  invt_caful_yn: string;       // 투자 유의 여부
  mrkt_warn_cls_code: string;  // 시장 경고 구분 코드
  short_over_yn: string;
  sltr_yn: string;
}

export interface KisStockPriceResponse {
  output: KisStockPriceOutput;
  rt_cd: string;   // 응답 코드 (0: 정상)
  msg_cd: string;  // 메시지 코드
  msg1: string;    // 메시지
}

export interface StockPrice {
  code: string;           // 종목 코드
  name: string;           // 종목명
  market: string;         // 시장 구분 (코스피/코스닥)
  sector: string;         // 업종
  currentPrice: number;   // 현재가
  change: number;         // 전일 대비 (등락)
  changeSign: string;     // 등락 부호
  changeRate: number;     // 등락률 (%)
  openPrice: number;      // 시가
  highPrice: number;      // 고가
  lowPrice: number;       // 저가
  prevClosePrice: number; // 전일 종가
  upperLimit: number;     // 상한가
  lowerLimit: number;     // 하한가
  volume: number;         // 거래량
  tradingValue: number;   // 거래대금
  askPrice: number;       // 매도호가
  bidPrice: number;       // 매수호가
  prevVolume: number;     // 전일 거래량
  investCaution: boolean; // 투자 유의 여부
  marketWarning: string;  // 시장 경고 코드
}