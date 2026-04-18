export interface KisStockInvestorOutput {
    stck_bsop_date: string; // 주식 영업일자
    stck_clpr: string; // 주식 종가
    prdy_vrss: string; // 전일 대비
    prdy_vrss_sign: string; // 전일 대비 부호 (1:상한 2:상승 3:보합 4:하락 5:하한)
    prsn_ntby_qy: string; // 개인 순매수량
    frgn_ntby_qy: string; // 외국인 순매수량
    orgn_ntby_qy: string; // 기관 순매수량
    prsn_nbty_tr_pbmn: string; // 개인 순매수 거래대금
    frng_ntby_tr_pbmn: string;
    orgn_ntby_tr_pbmn: string;
    // 매수2는 현재 배제
    prsn_seln_vol: string; // 개인 매도량
    frgn_seln_vol: string; // 외국인 매도량
    orgn_seln_vol: string; // 기관 매도량
    prsn_seln_tr_pbmn: string; // 개인 매도 거래대금
    frgn_seln_tr_pbmn: string;
    orgn_seln_tr_pbmn: string;
}
export interface KisStockInvestorResponse{
    rt_cd: string; // 응답 코드 (0: 정상)
    msg_cd: string; // 메시지 코드
    msg1: string; // 메시지
    output: KisStockInvestorOutput[];
}
export interface StockInvestor{
    date: string; // 날짜
    closePrice: number; // 종가
    change: number; // 전일 대비
    changeSign: string; // 전일 대비 부호
    personalNetBuyVolume: number; // 개인 순매수량
    foreignNetBuyVolume: number; // 외국인 순매수량
    institutionalNetBuyVolume: number; // 기관 순매수량
    personalNetBuyValue: number; // 개인 순매수 거래대금
    foreignNetBuyValue: number; // 외국인 순매수 거래대금
    institutionalNetBuyValue: number; // 기관 순매수 거래대금
    personalSellVolume: number; // 개인 매도량
    foreignSellVolume: number; // 외국인 매도량
    institutionalSellVolume: number; // 기관 매도량
    personalSellValue: number; // 개인 매도 거래대금
    foreignSellValue: number; // 외국인 매도 거래대금
    institutionalSellValue: number; // 기관 매도 거래대금
    // 매수2는 현재 배제
}