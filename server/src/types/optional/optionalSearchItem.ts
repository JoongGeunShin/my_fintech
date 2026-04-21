export interface KisOpstionalSearchResponse{
    rt_cd: string;  // 성공 실패 여부
    msg_cd: string; // 응답코드
    msg1: string;   // 응답메시지
    output2: KisOptionalSearchOutput2[]; // 결과 데이터
}

export interface KisOptionalSearchOutput2 {
    code: string;         // 종목 코드
    name: string;         // 종목명
    daebi: string;        // 대비 (전일 대비)
    price: string;        // 현재가
    chgrate: string;      // 등락률
    acml_vol: string;     // 거래량
    trade_amt: string;    // 거래대금
    change: string;       // 전일대비
    cttr: string;         // 체결강도
    open: string;         // 시가
    high: string;         // 고가
    low: string;          // 저가
    high52: string;       // 52주 최고가
    low52: string;        // 52주 최저가
    expprice: string;     // 예상체결가
    expchange: string;    // 예상대비
    expchggrate: string;  // 예상등락률
    expcvol: string;      // 예상체결수량
    chgrate2: string;     // 전일거래량대비율
    expdaebi: string;     // 예상대비부호
    recprice: string;     // 기준가
    uplmtprice: string;   // 상한가
    dnlmtprice: string;   // 하한가
    stotprice: string;    // 시가총액
}

export interface OptionalSearchList {
    seq: string; // 조건 검색 고유 번호
    list: OptionalSearchItem[];
}

export interface OptionalSearchItem{
    code: string;         // 종목 코드
    name: string;         // 종목명
    daebi: string;        // 대비 (전일 대비)
    price: string;        // 현재가
    chnageRate: string;   // 등락률
    tradeVolume: string;  // 거래량
    tradeAmount: string;  // 거래대금
    change: string;       // 전일대비
    gangdo: string;       // 체결강도
    openPrice: string;    // 시가
    highPrice: string;    // 고가
    lowPrice: string;     // 저가
    high52Price: string;         // 52주 최고가
    low52Price: string;          // 52주 최저가
    expectPrice: string;         // 예상체결가
    expectChange: string;        // 예상대비
    expectChangeRate: string;    // 예상등락률
    expectVolume: string;        // 예상체결수량
    changeRateYesterday: string; // 전일거래량대비율
    expectDaebi: string;         // 예상대비부호
    recprice: string;            // 기준가
    uplmtprice: string;          // 상한가
    dnlmtprice: string;          // 하한가
    stotprice: string;           // 시가총액
}