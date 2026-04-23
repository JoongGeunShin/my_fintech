export interface KisOptionalSearchListResponse {
    rt_cd: string;   // 성공 실패 여부
    msg_cd: string;  // 응답코드
    msg1: string;    // 응답메시지
    output2: KisOptionalSearchListOutput2[]; // 조건 검색 리스트 
}

export interface KisOptionalSearchListOutput2 {
    user_id: string;
    seq: string;
    grp_nm: string;
    condition_nm: string;
}

export interface OptionalSearchList{
    optionalSearchList: OptionalSearchListItem[];
}   

export interface OptionalSearchListItem {
    user_id: string;
    sequence: string;
    groupName: string;
    conditionName: string;
}