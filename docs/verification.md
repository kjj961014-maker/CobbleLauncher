# 개발 검증 기록

검증일: 2026-10-09 (Asia/Seoul). 현재 버전은 **0.1.3 개발 빌드**이며, 요청된 전체 런처의 최종 완료 판정은 아직 하지 않았습니다.

## 실제 파일·프로세스로 확인한 항목

| 항목 | 결과와 근거 |
| --- | --- |
| 개발 환경 | Node.js 24.21.0, npm 11.19.0, Git 2.53.0.windows.3 실행 확인 |
| 제공 자료 | ZIP 4개와 참고 화면 4개 조사. EML 두 ZIP은 소스, Playwright ZIP은 MCP 소스이며 폴더에 넣은 것만으로 연결되지 않음 |
| 원본 모드팩 | 실제 ZIP SHA-256·manifest·NeoForge 21.1.252·345개 ID·3,268개 overrides 검사. catalog와 원본 files 배열 일치 |
| Minecraft 설치 | 공식 1.21.1 본체·라이브러리·게임 리소스 3,888개 다운로드 및 해시 검사 통과 |
| Java 설치 | Mojang 공식 Windows64 Java21 런타임 설치. 실제 java.exe -version에서 Microsoft OpenJDK 21.0.7+6-LTS 확인 |
| NeoForge | 공식 21.1.252 installer와 실제 Java processor 실행 완료. core로 설치된 버전 JSON과 라이브러리 해석 성공 |
| 재설치/캐시 | 같은 테스트 instance에 설치를 다시 실행해 정상 파일을 재사용하고 강화한 경로·호스트 검증 통과 |
| Electron | TypeScript·Vite production 빌드, Electron 창·preload IPC 실제 실행 및 화면 캡처 통과 |
| UI 조작 | 실제 Electron 격리 프로필에서 첫 안내·설정 저장·5개 메뉴·최소1000×700 배치·오류 없는 렌더링·Windows safeStorage 암호화·평문 키 비노출·인증 없는 설치 차단·로그인 팝업 격리·취소·자동 닫기 등 47개 검사 통과. 최신 세부 기록은 test-results/ui-electron/report.json |
| 패키징 | Windows x64 NSIS 설치형 EXE 생성. 개발 PC의 격리 설치 폴더에 실제 NSIS 설치(종료0)→설치된 EXE와 IPC smoke 검사→테스트 설치 제거(종료0) 통과. win-unpacked 패키지 실행도 통과. 최종 바이너리 해시는 test-results/release-verification.json |
| 운영 CLI | 테스트용 개인키 생성·공지 초안 서명·서명 재검증 실행 통과. 테스트 개인키는 private 아래로 배포에서 제외 |
| 라이선스 | production 의존성 고지 생성. 게임/모드/팩 ZIP/overrides/셰이더/MCP 자료/테스트 자격증명은 EXE에 포함하지 않음 |

실제 기본 게임 설치 결과는 `test-results/minecraft-install.json`에 남겼습니다. 설치 위치는 `private/test-instance`이며 실제 Minecraft 계정으로 게임을 실행한 위치가 아닙니다. 설치된 게임과 Java는 개발 검증 자료로 유지하고 EXE에서 제외합니다.

## 통제된 응답과 실제 임시 파일로 검증한 항목

`npm test`는 현재 67개 테스트가 통과했습니다. 새 변경 후의 정확한 합계는 실행 결과를 기준으로 합니다.

- 공식 OAuth PKCE/state·callback 위조·취소·시간 초과·토큰 갱신·Xbox 사용자 불일치·가족 제한·Java 소유권 거부: 실제 loopback 서버와 통제된 인증 응답 사용. 실제 Microsoft 로그인을 대체한 완료 판정이 아닙니다.
- HTTPS redirect·호스트 제한·자격증명 헤더 제거·Range 206/200/416·스트림 중단·완성 캐시·해시 오류·빈 파일 패치: 통제된 HTTP 응답과 실제 파일 쓰기 사용.
- 모드팩 파일의 API 분류·저작자 opt-out·ZIP 자동 획득·설정 및 월드 보존·관리 파일 삭제·충돌·디스크 오류·중단 복구: 통제된 CurseForge/CDN 응답과 실제 파일/ZIP 사용.
- Ed25519 서명·변조·보호 경로·이전 순서·동일 순서 다른 내용·같은 서명 파일 복구·개인 설정·변경 파일만 다운로드·rollback·재시작 journal 복구·연결 폴더·동시 작업: 실제 서명과 파일 시스템, 통제된 다운로드 사용.
- 실제 설치된 Minecraft/NeoForge/Java를 기준으로 실행 인자·메모리·모듈 경로·Microsoft 프로필/토큰 전달·Client ID·optional XUID placeholder·서버 연결 인자·공백 경로를 확인했습니다. 가짜 계정으로 Java를 실행하지 않았습니다.

`npm audit --omit=dev`에서 보고된 production 의존성 취약점은 0개입니다. 이는 npm 데이터베이스의 해당 시점 결과이며 게임 모드·Java 전체 보안 감사를 의미하지 않습니다.

## 외부 준비 후 남은 실제 검증

| 남은 항목 | 현재 필요한 조건 |
| --- | --- |
| 실제 정품 로그인과 세션 유지 | 운영자의 Microsoft public-client 앱 등록·Minecraft API 승인, 사용자의 대화형 로그인 |
| 모드팩 345개 전체 실제 다운로드 | 본인 개발자 CurseForge 키 및 허용된 이용 조건. API 반환 정보와 저작자 정책에 따라 차단 파일 여부 확인 |
| 모든 모드의 재배포 허가 | 345개 각각의 라이선스/권한 검토 또는 공식 허용 다운로드 이용. 모드팩 All Rights Reserved와 생성 셰이더 조건 준수 |
| Immersive Cobblemon 실제 게임 실행 | 위 설치·로그인 완료 후 메인 메뉴·모드 로딩·게임 프로세스 종료·실제 서버 접속까지 확인 |
| 운영 업데이트/실시간 공지 | 실제 운영 HTTPS 채널·고정 공개키·운영자 쓰기 권한·서버 주소 설정 후 연결 검증 |
| 새 PC에서 설치 프로그램→로그인→설치→실행 | 별도 깨끗한 Windows PC 또는 VM에서 실행. 현재 개발 PC의 smoke 검사를 새 PC 검증이라고 보고하지 않음 |
| 일반 이용자 배포 | CurseForge 승인 통합/키 배포 조건, 저작권 허가, 실제 전체 구동 및 새 PC 검사. 현재 EXE는 코드 서명되지 않은 개발 빌드 |

등록과 비용 설명은 `service-setup.md`, 이용자 안내는 `user-guide.md`, 배포 과정은 `administrator.md`를 확인하세요. GitHub 소스 저장소와 소개 사이트가 공개되었고, 사용자 보고에 따라 CurseForge API 신청은 제출 후 검토 대기 중입니다. 유료 서비스 결제와 Minecraft 인증 우회는 수행하지 않았습니다.

## 0.1.1 로그인 대기 수정

사용자 환경에서 로그인 브라우저가 보이지 않고 0%의 '작업 준비 중'으로 표시되는 문제를 확인했습니다. 로그에는 인증 callback 대기 후 시간 초과가 기록되었습니다. Microsoft Client ID는 사용자 설정에 저장되어 있었습니다. Windows 기본 HTTPS 연결 프로그램은 Edge로 등록되어 있으나 브라우저 창이 보이지 않은 정확한 OS 원인은 확인하지 못했습니다.

OS 브라우저 실행 Promise가 끝나지 않아도 정상 callback·취소·5분 제한이 작동하도록 수정했습니다. 실제 Electron에서 브라우저 실행을 의도적으로 정지시키고 공식 PKCE 로그인 주소 복사·취소·재시도·만료된 주소 복사 거부를 확인했습니다. 테스트는 격리 프로필과 클립보드 대체 함수를 사용하여 사용자 계정이나 실제 클립보드를 건드리지 않았습니다. 로그인 주소 복사와 취소 버튼이 최소 창 크기에서 하단 바 위에 보이는 것도 확인했습니다.

기본 브라우저가 열리지 않으면 사용자가 로그인 주소를 Chrome 또는 Edge에 직접 붙여넣을 수 있습니다. 로그인 중에는 단계 안내를 표시하며, 설정 저장 버튼이 관계없는 로그인 작업 때문에 회전하지 않습니다. 실제 Microsoft 로그인 성공과 Minecraft 앱 승인은 여전히 별도 검증 항목입니다.

0.1.1 NSIS 설치 파일로 실제 사용자 설치 경로를 업데이트했고 종료 코드는 0이었습니다. 사용자 설정 JSON의 설치 전후 SHA-256이 일치하여 Client ID와 설정 보존을 확인했습니다. 설치된 0.1.1 EXE를 별도 QA 프로필에서 실행해 화면·preload IPC·오류 없음과 버전을 확인했으며, 최종 ASAR/main 해시 일치와 개인 자료 제외도 확인했습니다. 이 버전의 설치 제거 검사는 다시 수행하지 않았습니다. 설치 파일 SHA-256: `f7be0f38aa85a0c00141c9348f993bbc7a3db87d6d99e86c50328e0fdcab301c`.

## 0.1.2 Microsoft 로그인 팝업

기본 로그인 창을 독립된 Electron 자식 창으로 변경했습니다. Microsoft 공식 페이지를 그대로 표시하며, preload·Node·런처 IPC 권한 없이 sandbox와 contextIsolation을 적용합니다. 매 시도마다 메모리 전용 세션을 사용하고 창 종료 시 웹 저장소를 지웁니다. 최상위 이동은 등록된 Microsoft 호스트와 현재 시도의 정확한 loopback 주소로 제한합니다. 팝업이 지원하지 않는 로그인 방식은 기존 로그인 주소 복사로 외부 브라우저에서 계속할 수 있습니다.

실제 Electron 검사에서 팝업 생성·권한 격리·외부 사이트 차단·취소 버튼·창 닫기·재시도를 확인했습니다. 통제된 인증 서버 응답으로 정상 callback 직후 팝업이 닫히고 소유권/프로필 검사가 계속되는 것도 확인했습니다. 자동 테스트 57개와 앱 검사 45개가 통과했습니다.

별도 임시 프로필에서 실제 등록 앱의 Microsoft 페이지가 팝업에 표시되는 것을 캡처했습니다(`test-results/popup-live/microsoft-popup.png`). 확인 시점에는 Microsoft가 `redirect_uri is not valid`를 반환했습니다. 운영자가 Azure의 모바일 및 데스크톱 애플리케이션 설정에 `http://localhost/callback`을 등록해야 합니다. 이 주소를 브라우저로 직접 방문하는 절차가 아님을 사용 안내에 명시했습니다. 실제 계정 로그인 성공은 아직 확인하지 않았습니다.

실제 사용자 설치를 0.1.2로 업데이트했고 NSIS 종료 코드는 0입니다. 설정 JSON의 설치 전후 SHA-256이 일치하며, 설치된 EXE의 별도 QA 실행에서 0.1.2 버전·화면·IPC·오류 없음이 확인되었습니다. 설치 파일 SHA-256: `8ea2c0627ff9d23d3cada934a34ca597f556113af59bcca2ab5dabb3f84b25fd`.

## 0.1.3 인증 응답 오류 분류

운영자가 Azure에 loopback 반환 주소를 등록한 뒤, 실제 사용자 로그에서 `인증 서버 응답을 읽을 수 없습니다` 오류가 확인되었습니다. 이전 코드는 HTTP 상태 확인 전에 응답 본문을 JSON으로 파싱했기 때문에, 빈 응답이나 HTML 오류를 받으면 실제 실패 단계를 가렸습니다. 기존 로그만으로는 사용자 요청이 실패한 서버와 HTTP 상태를 확정할 수 없습니다.

오류 응답의 HTTP 상태를 보존하고 Microsoft 토큰 교환·Xbox 인증·XSTS 권한·Minecraft 로그인·소유권·프로필 단계를 구분하도록 변경했습니다. Minecraft 로그인 HTTP 403, 프로필 404, 사용량 제한 429, 서비스 오류 5xx는 JSON 본문이 없어도 각각 처리합니다. HTTP 200의 잘못된 본문은 성공으로 인정하지 않습니다. Microsoft 오류 코드는 검증된 숫자 AADSTS 코드만 표시합니다.

진단 로그에는 고정된 단계명·HTTP 번호·json/empty/non-json 구분만 남깁니다. 인증 코드·토큰·계정 식별자·원본 서버 본문은 진단에 전달하지 않습니다. 의도적으로 유효하지 않은 진단용 입력으로 Xbox의 빈 HTTP 401 및 XSTS의 빈 HTTP 400 응답을 확인했으나, 이는 사용자의 실제 실패 단계가 같다는 증거는 아닙니다.

기본 검사 67개와 실제 Electron UI 검사 47개가 통과했습니다. UI 검사에서는 빈 Xbox 401 응답 이후 정확한 단계 표시·프로필 미생성·재시도 가능·진단 로그의 비밀 값 제외를 확인했습니다. 실제 사용자 로그인은 수정된 버전에서 재시도하여 확인해야 합니다. 설치 파일 SHA-256: `0ee14c263caad854b0ec451f328f79e02ddc0f5ea605c2f261631df5af2144fa`.

사용자 설치 경로를 0.1.3으로 업데이트했고 NSIS 종료 코드는 0입니다. 설정 파일은 설치 전후 SHA-256이 일치하며, 설치된 EXE의 격리 smoke 검사와 최종 ASAR/auth·main·popup 파일 일치 검사를 통과했습니다.
