# 개발 검증 기록

검증일: 2026-10-09 (Asia/Seoul). 현재 버전은 **0.1.0 개발 빌드**이며, 요청된 전체 런처의 최종 완료 판정은 아직 하지 않았습니다.

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
| UI 조작 | 실제 Electron 격리 프로필에서 첫 안내·설정 저장·5개 메뉴·최소1000×700 배치·오류 없는 렌더링·Windows safeStorage 암호화·평문 키 비노출·인증 없는 설치 차단 등 32개 검사 통과. 최신 세부 기록은 test-results/ui-electron/report.json |
| 패키징 | Windows x64 NSIS 설치형 EXE 생성. 개발 PC의 격리 설치 폴더에 실제 NSIS 설치(종료0)→설치된 EXE와 IPC smoke 검사→테스트 설치 제거(종료0) 통과. win-unpacked 패키지 실행도 통과. 최종 바이너리 해시는 test-results/release-verification.json |
| 운영 CLI | 테스트용 개인키 생성·공지 초안 서명·서명 재검증 실행 통과. 테스트 개인키는 private 아래로 배포에서 제외 |
| 라이선스 | production 의존성 고지 생성. 게임/모드/팩 ZIP/overrides/셰이더/MCP 자료/테스트 자격증명은 EXE에 포함하지 않음 |

실제 기본 게임 설치 결과는 `test-results/minecraft-install.json`에 남겼습니다. 설치 위치는 `private/test-instance`이며 실제 Minecraft 계정으로 게임을 실행한 위치가 아닙니다. 설치된 게임과 Java는 개발 검증 자료로 유지하고 EXE에서 제외합니다.

## 통제된 응답과 실제 임시 파일로 검증한 항목

`npm test`는 현재 52개 테스트가 통과했습니다. 새 변경 후의 정확한 합계는 실행 결과를 기준으로 합니다.

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

등록과 비용 설명은 `service-setup.md`, 이용자 안내는 `user-guide.md`, 배포 과정은 `administrator.md`를 확인하세요. 현재 외부 계정 가입·유료 서비스 결제·업데이트 사이트 공개 게시·Minecraft 인증 우회는 수행하지 않았습니다.
