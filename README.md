# Cobble Launcher

An independent, non-commercial Windows Minecraft launcher being developed for a private group of **up to 10 friends**. The initial target is Immersive Cobblemon 6.2.0 for Minecraft Java Edition 1.21.1 with NeoForge 21.1.252 and Java 21. The intended experience includes Microsoft account authentication, installation from permitted official sources, signed updates, server announcements, and a Korean-language interface.

**Status: 0.1.1 development preview.** Live Microsoft login, the complete modpack download, full game launch, and server connection still need end-to-end verification. CurseForge API access and an approved integration for end-user downloads are being arranged. No CurseForge approval is claimed, and developer API keys are not bundled or shared with players.

The static project introduction is in [`docs/index.html`](docs/index.html). It can be hosted on GitHub Pages from the `main` branch's `/docs` folder after the repository is published.

한국어 Windows 64비트 Minecraft 런처의 **0.1.1 개발 빌드**입니다. 제공된 Immersive Cobblemon 6.2.0 ZIP을 분석하여 Minecraft 1.21.1, NeoForge 21.1.252, Java 21을 설치 대상으로 확정했습니다.

실제 Electron 앱과 NSIS 설치형 EXE를 생성합니다. Microsoft 정품 인증·파일 설치·서명된 증분 패치 코드를 구현했으며, 실제 계정 로그인과 모드팩 전체 게임 구동은 외부 서비스 등록 후 추가 검증이 필요합니다. 검증 범위는 [검증 기록](docs/verification.md)에 구분되어 있습니다.

## 실행 및 빌드

```powershell
cd E:\CobbleLauncher\launcher
npm ci
npm run dev
npm test
npm run test:ui
npm run dist
```

`npm run dist`는 `release/CobbleLauncher-Setup-0.1.1.exe`를 만듭니다. Node.js는 개발·빌드 PC에만 필요하며, 설치형 런처는 Electron과 함께 실행됩니다. 게임용 Java 21은 Mojang의 공식 런타임에서 별도로 설치합니다. UI 검사는 Playwright 개발 패키지 또는 Codex 번들 Playwright 경로가 필요합니다.

## 이용자 및 운영자 안내

- [설치와 사용](docs/user-guide.md)
- [Microsoft·Minecraft·CurseForge 등록](docs/service-setup.md)
- [공지·서명 업데이트 운영](docs/administrator.md)
- [모드팩 분석과 재배포 조건](docs/modpack-analysis.md)
- [제공 소스/MCP 및 기반 조사](docs/research.md)
- [검증 기록과 남은 작업](docs/verification.md)

`resources/deployment.json`은 운영자가 빌드 전에 설정할 공개 Client ID, 업데이트 URL/검증키, 서버 주소, 기본 메모리입니다. CurseForge 비밀 키나 업데이트 개인 서명키는 배포물에 넣지 않습니다. 현재 개발 빌드에는 운영 채널과 Client ID가 설정되어 있지 않습니다.

## 구성

`src/main`은 인증·Windows 암호화 저장·다운로드·설치·업데이트·서버 상태와 IPC를 담당합니다. `src/preload`는 승인된 메서드만 화면에 제공하고, `src/renderer`는 한국어 React UI입니다. 웹 화면에는 Node 권한이나 로그인 토큰/API 키를 전달하지 않습니다.

기반은 Electron, React, TypeScript, Vite와 MIT 라이선스의 XMCL입니다. `scripts/fix-xmcl.cjs`는 고정한 XMCL 패키지의 배포 메타데이터 결함을 재현 가능하게 보정합니다. 새 패키지로 업그레이드할 때 이 보정과 설치 테스트를 다시 검토해야 합니다. `THIRD-PARTY-NOTICES.txt`와 Electron/Chromium 라이선스가 배포본에 포함됩니다.

모드팩 ZIP, 게임 본체, Java, 모드 JAR, 셰이더와 포켓몬 이미지 등 제삼자 게임 콘텐츠는 설치형 EXE에 포함하지 않습니다. 각 공식 다운로드와 라이선스 조건을 따릅니다.
