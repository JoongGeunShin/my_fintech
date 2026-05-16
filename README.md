# my-fintech

한국 주식 시장을 위한 **실시간 종목 스크리닝 + 자동매매 대시보드**입니다.  
KIS(한국투자증권) Open API와 Firebase를 기반으로 동작하며, 직접 설계한 퀀트 지표와 조건검색을 통해 종목을 필터링하고 매매 신호를 생성합니다.

> **주의:** 이 프로젝트는 개인 투자 연구 목적으로 제작되었습니다. 실제 투자에 사용 시 발생하는 모든 손익에 대한 책임은 사용자 본인에게 있습니다. 자세한 내용은 [사용 주의사항](#-사용-주의사항)을 반드시 읽어주세요.

---

## 목차

- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [아키텍처](#아키텍처)
- [디렉토리 구조](#디렉토리-구조)
- [시작하기](#시작하기)
- [환경변수](#환경변수)
- [조건검색 설정](#조건검색-설정)
- [사용 주의사항](#-사용-주의사항)

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **실시간 종목 스크리닝** | eFriend Expert 조건검색 결과를 레벨별로 분류해 Firebase에 저장, 실시간 구독 |
| **캔들 차트** | KIS API 기반 일/월/년봉 차트 (드래그 패닝, 휠 줌, 이동평균선) |
| **실시간 호가/체결** | KIS WebSocket으로 호가창 및 체결 데이터 실시간 수신 |
| **퀀트 지표 엔진** | VWAP, CVD, TIS, BOR, 체결강도, 주포 감지를 조합한 복합 신호 생성 |
| **자동매매 (가상/실전)** | 시간대별 전략, ATR 기반 손절, 위험 비율 기반 포지션 사이징 |
| **협업 캔버스** | Konva.js + Rough.js 기반 자유 드로잉, 차트 스냅샷 올리기 지원 |

---

## 기술 스택

### Frontend

| 분류 | 기술 |
|------|------|
| 프레임워크 | React 19 + TypeScript |
| 빌드 도구 | Vite 8 |
| 라우팅 | React Router v7 |
| 캔버스 | Konva.js + react-konva, Rough.js |
| 실시간 통신 | Socket.io-client |
| 인증/DB | Firebase (Firestore, Auth) |

### Backend

| 분류 | 기술 |
|------|------|
| 런타임 | Node.js + TypeScript (ESM) |
| 프레임워크 | Express 5 |
| 실시간 통신 | Socket.io |
| 주식 데이터 | KIS Open API (REST + WebSocket) |
| 데이터 저장 | Firebase Admin SDK (Firestore) |
| 개발 도구 | tsx (hot-reload) |

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React)                          │
│                                                                 │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │  Screening  │  │  StockChart   │  │   Collab Canvas      │  │
│  │   Panel     │  │  (캔들차트)    │  │  (Konva + 차트 올리기)│  │
│  └──────┬──────┘  └───────┬───────┘  └──────────────────────┘  │
│         │                 │                                     │
│  ┌──────▼──────────────────▼──────────────────────────────────┐ │
│  │            useScreeningFirestore / useTradingEngine        │ │
│  └──────┬──────────────────────────────────────────┬──────────┘ │
└─────────┼──────────────────────────────────────────┼────────────┘
          │ Firestore 실시간 구독                      │ REST + Socket.io
          ▼                                           ▼
┌──────────────────────┐              ┌───────────────────────────┐
│   Firebase Firestore  │              │    Node.js Backend        │
│                       │              │                           │
│  screenedLevel2/3     │◄─────────────│  screeningScheduler       │
│  screeningRuns        │  스크리닝     │  (30분 주기 자동 실행)     │
│  virtualPortfolio     │  결과 저장    │                           │
└──────────────────────┘              │  tradingEngineService     │
                                      │  quantMetricsService      │
                                      │  preMarketFilterService   │
                                      └──────────┬────────────────┘
                                                 │ WebSocket + REST
                                                 ▼
                                      ┌──────────────────────────┐
                                      │   KIS Open API           │
                                      │  - 현재가/기간 시세       │
                                      │  - 조건검색 실행          │
                                      │  - 호가/체결 WebSocket    │
                                      │  - 매수/매도 주문         │
                                      └──────────────────────────┘
```

---

## 디렉토리 구조

```
my_fintech/
├── src/                          # React 프론트엔드
│   ├── domain/
│   │   └── entities/Canvas/      # Konva 캔버스 엔티티
│   └── presentation/
│       ├── components/
│       │   ├── Canvas/           # 협업 캔버스 (Konva + Rough.js)
│       │   ├── ScreeningPanel/   # 종목 스크리닝 3열 랭킹
│       │   ├── StockChart/       # 캔들 차트 (HTML5 Canvas)
│       │   └── RealtimePanel/    # 실시간 호가/체결
│       ├── hooks/
│       │   ├── useScreeningFirestore.ts  # Firestore 스크리닝 구독
│       │   ├── useTradingEngine.ts       # 자동매매 상태 관리
│       │   ├── useRealtimeStock.ts       # KIS WebSocket 훅
│       │   └── useKonvaCanvas.ts         # 캔버스 드로잉 훅
│       └── pages/
│           ├── home/             # 메인 페이지 (스크리닝 + 차트)
│           └── trading/          # 자동매매 대시보드
│
├── server/                       # Node.js 백엔드
│   └── src/
│       ├── services/
│       │   ├── strategy/
│       │   │   ├── quantMetricsService.ts   # 퀀트 지표 계산 엔진
│       │   │   └── tradingEngineService.ts  # 자동매매 실행 엔진
│       │   ├── optional/
│       │   │   ├── screeningPipelineService.ts  # 조건검색 파이프라인
│       │   │   └── preMarketFilterService.ts    # 장전 필터
│       │   └── kis/              # KIS API 클라이언트
│       ├── scheduler/
│       │   ├── screeningScheduler.ts    # 정기 스크리닝 스케줄러
│       │   └── realtimeStockScheduler.ts
│       ├── repositories/         # Firestore CRUD
│       └── socket/               # Socket.io 이벤트 핸들러
│
├── .env                          # 프론트 환경변수 (gitignored)
├── .env.example                  # 프론트 환경변수 템플릿
└── server/.env.example           # 서버 환경변수 템플릿
```

---

## 시작하기

### 사전 준비

- Node.js 18+
- [KIS Open API](https://apiportal.koreainvestment.com) 신청 및 앱키 발급
- [Firebase](https://console.firebase.google.com) 프로젝트 생성 (Firestore, Authentication 활성화)
- eFriend Expert에 조건검색 그룹 설정 ([조건검색 설정](#조건검색-설정) 참고)

### 1. 저장소 클론

```bash
git clone https://github.com/your-username/my-fintech.git
cd my-fintech
```

### 2. 프론트엔드 설정

```bash
npm install
cp .env.example .env
# .env 파일을 편집해서 Firebase 설정값 입력
```

### 3. 백엔드 설정

```bash
cd server
npm install
cp .env.example .env
# .env 파일을 편집해서 KIS API, Firebase, 전략 파라미터 입력
```

### 4. 실행

터미널 2개를 열어 각각 실행합니다.

```bash
# 터미널 1 — 백엔드
cd server && npm run dev

# 터미널 2 — 프론트엔드
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

---

## 환경변수

### 프론트엔드 `.env`

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_MEASUREMENT_ID=
VITE_SERVER_URL=http://localhost:3000
```

### 서버 `server/.env`

전체 항목은 `server/.env.example`을 참고하세요. 주요 섹션은 다음과 같습니다.

#### KIS API

| 변수 | 설명 |
|------|------|
| `KIS_ACCOUNT_NUMBER` | KIS 계좌번호 |
| `KIS_API_APP_KEY` | KIS Open API 앱키 |
| `KIS_API_APP_SECRET_KEY` | KIS Open API 시크릿키 |
| `REAL_MODE_SECRET` | 실전 모드 활성화 비밀번호 (임의 문자열) |

#### Firebase Admin

| 변수 | 설명 |
|------|------|
| `FIREBASE_PROJECT_ID` | Firebase 프로젝트 ID |
| `FIREBASE_CLIENT_EMAIL` | 서비스 계정 이메일 |
| `FIREBASE_PRIVATE_KEY` | 서비스 계정 비공개 키 (`\n` 포함, 따옴표로 감쌀 것) |

#### 퀀트 지표 파라미터 (`QUANT_*`)

조건검색 및 실시간 호가 데이터를 종합하는 신호 생성 엔진의 파라미터입니다.  
각 지표의 정의와 적합한 값은 **직접 백테스트를 통해 결정**해야 합니다.

| 변수 | 설명 |
|------|------|
| `QUANT_WALL_MULTIPLIER` | 호가 벽 판정 배수 (평균 잔량 대비) |
| `QUANT_MIN_MINUTE_VOLUME` | 진입 허용 최소 분봉 거래량 |
| `QUANT_BUY_SCORE_THRESHOLD` | 매수 신호 발생 최소 점수 (0 ~ 1) |
| `QUANT_SELL_SCORE_THRESHOLD` | 매도 신호 발생 최소 점수 (0 ~ 1) |
| `QUANT_BUY_BOR_MAX` | 매수 허용 최대 BOR (매도잔량/매수잔량) |
| `QUANT_SELL_BOR_MIN` | 매도 조건 최소 BOR |
| `QUANT_ES_BUY_MIN` | 매수 허용 최소 체결강도 (%) |
| `QUANT_WEIGHT_BOR` | BOR 지표 가중치 |
| `QUANT_WEIGHT_TIS` | TIS(틱 불균형) 지표 가중치 |
| `QUANT_WEIGHT_CVD` | CVD(누적 거래량 델타) 지표 가중치 |
| `QUANT_WEIGHT_VWAP` | VWAP 편차 지표 가중치 |
| `QUANT_WEIGHT_ES` | 체결강도 가중치 |
| `QUANT_WEIGHT_JUPO` | 주포 감지 점수 가중치 |

> 가중치 합계(`BOR + TIS + CVD + VWAP + ES + JUPO`)는 반드시 **1.0**이 되어야 합니다.

#### 리스크 관리 파라미터 (`TRADE_*`)

| 변수 | 설명 | 예시 |
|------|------|------|
| `TRADE_STOP_LOSS_RATE` | 손절 비율 (음수) | `-0.04` |
| `TRADE_TAKE_PROFIT_RATE` | 1차 익절 비율 | `0.02` |
| `TRADE_ENHANCED_PROFIT_RATE` | 고수익 익절 비율 | `0.03` |
| `TRADE_JUPO_QUICK_PROFIT` | 주포 신호 빠른 익절 비율 | `0.015` |
| `TRADE_RISK_PER_TRADE` | 계좌 대비 최대 위험 비율 | `0.05` |
| `TRADE_MAX_POSITION_RATE` | 단일 포지션 최대 비율 | `0.5` |
| `TRADE_DAILY_LOSS_LIMIT` | 일간 손실 한도 (음수) | `-0.05` |
| `TRADE_MIN_VRATE_TO_BUY` | 진입 허용 최소 거래량 비율 (현재/평균) | `1.5` |

#### 조건검색 가중치 (`SCREENING_*`)

| 변수 | 설명 |
|------|------|
| `SCREENING_MAIN_GROUP` | Firestore 그룹명 (eFriend 조건 그룹명과 일치) |
| `SCREENING_WEIGHT_REQUIRED` | `[필수]` 조건 통과 시 점수 |
| `SCREENING_WEIGHT_SUPPORT` | `[보조]` 조건 통과 시 점수 |
| `SCREENING_WEIGHT_DETAIL` | `[세부]` 조건 통과 시 점수 |

---

## 조건검색 설정

이 프로젝트의 스크리닝 엔진은 **eFriend Expert의 조건검색 기능**과 연동됩니다.  
실제 조건(기술적 지표, 필터 기준 등)은 각자가 직접 eFriend Expert에서 설계·저장해야 합니다.

### 조건 그룹 구조

eFriend Expert에서 조건을 저장할 때 **그룹명**을 지정합니다.  
`SCREENING_MAIN_GROUP`에 지정한 그룹명의 조건들만 레벨 분류에 사용됩니다.

### 조건 이름 규칙

각 조건 이름의 **접두어**로 카테고리를 구분합니다.

| 접두어 | 의미 | 역할 |
|--------|------|------|
| `[필수]` | 핵심 진입 조건 | 미통과 시 종목 제외 |
| `[기본]` | 시장/섹터 필터 | 최소 1개 이상 통과해야 후보 포함 |
| `[보조]` | 보조 확인 조건 | 통과 수에 따라 Level 2 판정 |
| `[세부]` | 세밀한 필터 | 통과 시 Level 3 판정 |

**레벨 판정 기준:**

```
[필수] 통과                           → Level 1
[필수] 통과 + [보조] 1개 이상 통과    → Level 2
[필수] 통과 + [보조] + [세부] 통과    → Level 3
```

Level이 높을수록 자동매매 엔진에서 우선 진입 대상으로 처리됩니다.

---

## ⚠️ 사용 주의사항

### 금융 투자 위험

- 이 소프트웨어는 **투자 수익을 보장하지 않습니다.**
- 주식 투자에는 원금 손실 위험이 있으며, 자동매매 시스템은 예기치 않은 시장 상황에서 **큰 손실**을 초래할 수 있습니다.
- **반드시 가상매매 모드에서 충분히 테스트한 후** 실전 모드를 사용하세요.
- 실전 모드 사용 전 `TRADE_DAILY_LOSS_LIMIT`과 `TRADE_RISK_PER_TRADE`를 보수적으로 설정하세요.

### 기술적 위험

- KIS API 서버 오류, 네트워크 지연, WebSocket 연결 끊김 등으로 **주문이 의도대로 동작하지 않을 수 있습니다.**
- 시스템 장애 발생 시 포지션이 미청산 상태로 남을 수 있습니다. **KIS 앱/HTS에서 직접 확인하는 습관**을 들이세요.
- 실전 모드에서 서버를 재시작하면 기존 포지션을 KIS API로 재동기화하지만, 진입 시각을 복원할 수 없어 타임스탑 로직 동작이 달라질 수 있습니다.

### API 사용 제한

- KIS WebSocket은 **실전 최대 40개 TR, 모의 최대 20개 TR** 제한이 있습니다.
- 조건검색 API는 과도한 호출 시 KIS에서 차단될 수 있습니다. 스케줄러 주기를 30분 이하로 줄이지 마세요.

### 개인정보 및 보안

- `.env`, `server/.env` 파일을 **절대로 공개 저장소에 커밋하지 마세요.** (`.gitignore`에 등록되어 있음)
- KIS API 키와 Firebase 서비스 계정 키가 유출되면 즉시 재발급하세요.
- `REAL_MODE_SECRET`은 추측하기 어려운 값으로 설정하세요.

### 법적 고지

- 이 소프트웨어는 **MIT 라이선스** 하에 있으며, 어떠한 보증도 제공하지 않습니다.
- 자동매매 시스템의 사용이 본인의 증권사 약관 및 관련 법규를 위반하지 않는지 확인하세요.
- **개발자는 이 소프트웨어 사용으로 인한 투자 손실에 대해 어떠한 책임도 지지 않습니다.**
