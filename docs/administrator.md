# 공지·업데이트 운영

## 운영자와 이용자 설정

운영자만 원격 배포 파일과 개인 서명키를 관리합니다. 이용자의 런처는 배포 내용을 읽고 공개키로 검증하며, 운영 서버에 글을 쓰거나 패치를 올리는 기능이 없습니다. 실제 호스팅의 쓰기 권한은 해당 서비스의 운영자 계정으로 보호해야 합니다.

`resources/deployment.json`에 공개 Microsoft Client ID, HTTPS manifest URL, Ed25519 공개키, 서버 주소·포트, 기본 메모리를 입력한 뒤 빌드합니다. 배포본에 공개키가 설정되면 이용자는 런처 설정에서 그 키와 채널을 변경할 수 없습니다. 공지 및 패치 개인 서명키와 CurseForge 비밀 키는 이 파일에 넣지 않습니다.

Minecraft/NeoForge 버전을 바꾸거나 새 모드팩을 추가할 때는 원본 manifest·Java 요구 사항·출처·라이선스를 검토한 새 catalog와 호환되는 빌드가 필요합니다. 현재 파일 패치는 Minecraft 1.21.1 / NeoForge 21.1.252에 맞는 서버별 핫픽스용입니다. 전체 런처의 자동 EXE 교체는 이 개발 빌드의 구현 범위에 포함되지 않습니다.

## 서명키와 초안

```powershell
cd E:\CobbleLauncher\launcher
npm run admin -- init-keys private/signing
```

`private/signing/private.pem`은 운영자 전용 오프라인 보관 대상입니다. `public.pem` 내용은 배포 설정에 넣습니다. `private`는 Git과 패키징에서 제외되지만 별도 백업과 접근 권한 관리는 운영자가 수행합니다. 키가 유출되면 새 키를 고정한 새 런처 배포가 필요합니다.

초안 예시는 `examples/update-draft.json`입니다. 다음 항목을 설정합니다.

- `packId`, `minecraftVersion`, `loaderVersion`: catalog와 정확히 일치해야 합니다.
- `version`: 표시할 서버 패치 버전입니다.
- `sequence`: 새 배포마다 증가시키는 양의 정수입니다. 공지만 바뀌어도 증가시킵니다. 같은 순서에 다른 내용은 거부합니다.
- `files`: 실제 변경 파일 경로, HTTPS URL, `policy`를 지정합니다. 해시와 용량은 서명 도구가 실제 파일로 계산합니다.
- `removedPaths`: 이전에 런처가 관리한 파일만 제거할 수 있습니다. 사용자 수정 파일은 보존합니다.
- `announcements`, `patchNotes`: 한국어 제목·본문·게시일을 넣습니다. HTML/스크립트로 실행되지 않습니다.

`files`는 해당 패치에서 변경된 파일만 넣어도 됩니다. 기존 관리 기록과 합쳐 검사합니다. `managed`는 관리 대상 변경 파일이며, `seed`는 이미 존재하는 파일을 보존하는 최초 기본 설정입니다. 개인화한 설정은 `managed`라도 보존합니다. `mods`, `config`, `defaultconfigs`, `kubejs`, `resourcepacks`, `shaderpacks` 하위 일반 파일만 허용하고, 월드/스크린샷/옵션/실행 프로그램 경로는 거부합니다.

## 저작권 확인과 배포

`permissions.json`은 배포하는 **각 파일**에 대해 다음처럼 작성합니다.

```json
[
  {"path":"config/server-custom.json","redistributionAllowed":true,"license":"운영자가 직접 작성한 설정","sourceUrl":"https://your-own-project.example/source","reviewedBy":"실제 검토자"}
]
```

이는 운영자가 기록하는 허가 검토이며 자동 법률 판단이 아닙니다. 예시 값을 그대로 허가의 근거로 사용하지 않습니다. 모드팩의 All Rights Reserved, 모드별 라이선스, CurseForge 배포 정책을 먼저 확인합니다. 원본 팩에 포함된 생성 셰이더는 자체 호스팅하지 않습니다. 세부 사항은 `modpack-analysis.md`에 기록되어 있습니다.

```powershell
npm run admin -- sign draft.json private/signing/private.pem content permissions.json output/manifest.json
```

도구는 content 폴더의 경로와 실제 SHA-256·용량을 확인하고, 허가 기록이 없는 파일을 거부하며, Ed25519로 JSON의 원본 바이트를 서명한 envelope를 만듭니다. 서명한 뒤 payload를 다시 수정하지 않습니다. HTTPS 호스트에 검토된 파일을 먼저 올리고 마지막으로 manifest를 교체합니다. 호스팅 선택·공개 게시·외부 계정 가입은 아직 수행하지 않았습니다.

새 공지에도 `sequence`를 증가시킵니다. 클라이언트는 90초마다 새 공지를 읽고 게임 중이면 패치 적용을 대기합니다. 게임 종료 후 변경 파일을 staging에 다운로드·검증한 뒤 백업과 journal을 기록하고 교체합니다. 손상된 파일, 잘못된 서명, 이전 순서, 허용되지 않은 경로는 적용하지 않습니다.

## 적용 시점

| 변경 | 반영 시점 |
| --- | --- |
| 공지·패치 설명 | 실행 중 다음 조회, 최대 90초 주기 |
| 모드 JAR·리소스·클라이언트 설정 | 게임 종료 후 패치 적용, 다음 게임 실행 |
| 기본 메모리·서버 주소·Client ID·고정 공개키 | 배포 설정을 바꾼 새 런처 빌드; 개인 메모리/주소는 설정 저장 후 다음 실행 |
| 클라이언트 kubejs startup/client 스크립트 | 게임 재시작 |
| 서버 kubejs/server_scripts·데이터팩·밸런스 | 서버 쪽 파일도 별도 배포해야 함; 해당 모드의 공식 reload 지원 여부에 따라 리로드 또는 서버 재시작 |

클라이언트 런처는 원격 Minecraft 서버의 관리자 권한·재시작·데이터 리로드를 대신 수행하지 않습니다. 서버 전용 설정을 클라이언트에 배포한 것만으로 서버 밸런스가 바뀌었다고 판단하지 않습니다.

## 현재 남은 운영 준비

실제 Microsoft 앱 승인, CurseForge 운영 통합 허가, 개별 재배포 허가, HTTPS 배포 호스트, 서버 주소, 실제 licensed 계정의 로그인·전체 모드팩 실행, 새 PC 첫 설치 테스트가 필요합니다. 서버나 트래픽 비용은 호스팅 선택과 사용량에 따라 결정하며 유료 서비스 결제는 수행하지 않았습니다.
