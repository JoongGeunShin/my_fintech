// export interface KistStockPeriodSpecifiedOutput1 {

// }
export interface KisStockPeriodSpecifiedResponse {
    rt_cd: string;
    msg_cd: string;
    msg1: string;
    output: KisStockPeriodSpecifiedOutput1; 
    output2: KisStockPeriodSpecifiedOutput2[]; // 리스트 형태로 데이터가 옴    
}

export interface KisStockPeriodSpecifiedOutput1 {
    prdy_vrss: string;     // 전일 대비
    prdy_vrss_sign: string;    // 전일 대비 부호
    prdy_ctrt: string;    // 전일 대비율
    stck_prdy_clpr: string;    // 주식 전일 종가
    acml_vol: string;    // 누적 거래량
    acml_tr_pbmn: string;    // 누적 거래 대금
    hts_kor_isnm: string;    // HTS 한글 종목명
    stck_prpr: string;    // 주식 현재가
    stck_shrn_iscd: string;    // 주식 단축 종목코드
    prdy_vol: string;    // 전일 거래량
    stck_mxpr: string;    // 주식 상한가
    stck_llam: string;    // 주식 하한가
    stck_oprc: string;    // 주식 시가2
    stck_hgpr: string;    // 주식 최고가
    stck_lwpr: string;    // 주식 최저가
    stck_prdy_oprc: string;    // 주식 전일 시가
    stck_prdy_hgpr: string;    // 주식 전일 최고가
    stck_prdy_lwpr: string;    // 주식 전일 최저가
    askp: string;    // 매도호가
    bidp: string;    // 매수호가
    prdy_vrss_vol: string;    // 전일 대비 거래량
    vol_tnrt: string;    // 거래량 회전율
    stck_fcam: string;    // 주식 
    lstn_stcn: string;   
    cpfn: string;   // 자본금
    hts_avls: string;  //HTS 시가 총액
    per: string;
    eps: string;   
    pbr: string;    
    itewhol_loan_rmnd_ratem: string;
}

export interface KisStockPeriodSpecifiedOutput2 {
    stck_bsop_date: string;    // 주식 영업 일자
    stck_clpr: string;    // 주식 종가
    stck_oprc: string;    // 주식 시가2
    stck_hgpr: string;    // 주식 최고가
    stck_lwpr: string;    // 주식 최저가
    acml_vol: string;    // 누적 거래량
    acml_tr_pbmn: string;    // 누적 거래 대금
    flng_cls_code: string;    // 락 구분 코드
    prtt_rate: string;    // 분할 비율
    mod_yn: string;    // 변경 여부
    prdy_vrss_sign: string;    // 전일 대비 부호
    prdy_vrss: string;    // 전일 대비
    revl_issu_reas: string;    // 재평가사유코드
}
