# Immersive Cobblemon 실제 파일 분석

분석 기준일: 2026-10-09 (Asia/Seoul). 사용자가 제공한 ZIP을 실행하거나 전체 압축 해제하지 않고 중앙 디렉터리, `manifest.json`, `modlist.html`, 포함된 라이선스와 KubeJS 스크립트를 읽었다.

## 확정된 설치 대상

| 항목 | 확인 결과 |
| --- | --- |
| 원본 파일 | `modpack/Immersive Cobblemon - MC 1.21.1 - 6.2.0.zip` |
| 원본 크기 | 13,556,227 bytes |
| SHA-256 | `12caad59ca412847ec08d8b2aa3195bda87674dc5d897e91622496d6d445ea66` |
| Minecraft | `1.21.1` |
| 주 모드 로더 | `neoforge-21.1.252` (`primary: true`) |
| 모드팩 버전 | `6.2.0` (원본 manifest에는 앞쪽 공백이 있음) |
| manifest 형식 | `minecraftModpack`, `manifestVersion: 1` |
| 필수 파일 | CurseForge projectID/fileID 쌍 345개, 모두 `required: true` |
| 고정 파일 | `isLocked: true` 2개: 1389481/7849696, 889915/8653466 |
| overrides 경로 | `overrides` |
| 공식 프로젝트 | CurseForge project ID `1424698` |
| 공식 클라이언트 파일 | CurseForge file ID `9070240`, 2026-10-05 업로드 |
| Java | 64비트 Java 21 |

ZIP의 author 필드는 빈 문자열이다. 공식 페이지는 작성자를 Lupin으로 표시한다. 로컬 ZIP의 버전 및 로더를 설치의 기준으로 삼는다. 원본과 이름이 같은 공식 파일을 확인했지만, API 키가 없으므로 공식 CDN 파일의 바이트 해시와 로컬 ZIP의 일치까지 검증한 것은 아니다. [공식 파일 페이지](https://www.curseforge.com/minecraft/modpacks/immersive-cobblemon/files/9070240)

Java 21 요구 사항은 Minecraft 1.21.1용 [NeoForge 공식 문서](https://docs.neoforged.net/docs/1.21.1/gettingstarted/)에서 확인했다. 작성자는 최소 8 GB 메모리 할당을 권장한다. [모드팩 공식 설명](https://www.curseforge.com/minecraft/modpacks/immersive-cobblemon)

`resources/pack.json`에는 원본 345개 레코드를 순서와 ID, required, isLocked 값까지 그대로 기록했다. Minecraft/loader/pack 버전, 공식 페이지 링크, 로컬 archive SHA-256과 크기도 포함된다. 원본 manifest의 files 배열과 생성된 catalog의 files 배열이 동일함을 비교 검증했다. 중복 projectID/fileID는 없고 modlist 링크도 345개이다. modlist의 분류는 모드 330개, 리소스팩 13개, 셰이더 2개이다. 설치는 공식 API의 classId를 확인해 각각 `mods`, `resourcepacks`, `shaderpacks`로 배치한다.

## ZIP 구성과 설치 의미

총 3,270개 항목이다. 루트의 `manifest.json`, `modlist.html` 두 파일 외에는 3,268개 overrides 파일이다. 확장 크기는 31,600,301 bytes이다.

| overrides 그룹 | 파일 수 | 확장 크기 | 역할 |
| --- | ---: | ---: | --- |
| config | 1,448 | 6,743,660 | 모드 설정, 기본 옵션, 메뉴 이미지, 퀘스트/데이터, 이전 설정 백업 |
| journeymap | 498 | 780,322 | 설정 9개, 아이콘 478개, 서버 설정 10개, 로그 1개 |
| kubejs | 54 | 4,610,505 | 리소스/텍스처, 설정, client/startup/server 스크립트 |
| shaderpacks | 1,268 | 19,465,814 | Complementary Reimagined/Unbound r5.9.3 + Euphoria Patches 1.10.5의 확장된 셰이더 |

이 ZIP에는 Minecraft 본체, Java, NeoForge 설치 프로그램, 모드 JAR가 없다. 따라서 ZIP만 압축 해제하면 게임을 실행할 수 없다. 345개 원격 파일은 공식 CurseForge API에서 개별 메타데이터를 조회하고 다운로드해야 한다. manifest에는 파일명, 파일 크기, 다운로드 URL, 해시 또는 개별 라이선스가 없다. `modlist.html`은 프로젝트 페이지와 이름을 제공하지만 fileID의 바이트 해시를 대신할 수 없다.

KubeJS `server_scripts/recipes.js`는 Cobblemon monitor/fossil_analyzer/restoration_tank 제작법을 변경한다. client/startup main.js는 예제 로그만 기록한다. 이 분석 과정에서 스크립트를 실행하지 않았다. 실제 게임 실행 시에는 게임 모드가 스크립트를 실행하므로 런처가 별도의 JavaScript 실행 환경에서 이 스크립트를 실행할 필요는 없다.

경로에 `..`, 드라이브 접두어, 역슬래시, 절대경로가 있는 항목은 발견되지 않았다. EXE/DLL/BAT/CMD/PS1/VBS/SH/JAR 항목도 없었다. 이 결과는 ZIP의 경로 구조에 대한 검사이며 모든 모드의 안전성 검증을 의미하지 않는다. 향후 업데이트 ZIP도 별도로 경로 검증, 확장 크기 제한, symlink/reparse point 검사 후 전용 instance 내부에만 설치해야 한다.

## 배포 라이선스의 구체적 제약

모드팩 공식 페이지의 라이선스는 **All Rights Reserved**이다. 공개 다운로드 가능 여부와 자체 서버 재배포 권한은 별개다. 제공된 ZIP만으로 저작자의 재배포 허가를 확인할 수 없다. 따라서 런처 EXE에는 자체 소스와 pack catalog만 포함하고 모드팩 ZIP, overrides, 모드 JAR, 팩 로고/포켓몬 텍스처 등을 포함하지 않는다. 사용자의 개인 설치는 제공된 로컬 ZIP 또는 승인된 CurseForge 경로를 사용한다. 운영자가 팩 전체나 팩 고유 리소스를 재배포하려면 저작자 허가와 각 구성물의 조건을 확인해야 한다. [팩 라이선스 표시](https://www.curseforge.com/minecraft/modpacks/immersive-cobblemon/license)

포함된 `ComplementaryLicense.txt`는 Complementary License Agreement 1.7이다. §1.2는 조건부 모드팩 포함을 허용하지만 §1.2(d)는 CurseForge/Modrinth 시스템을 이용하도록 하고 직접 파일 업로드 방식의 재배포를 금지한다. 포함된 `EuphoriaPatchesLicense.txt`는 v1.1이며 §2.1은 patcher mod 또는 공식 installer로 생성한 복사본을 요구하고 직접 재배포를 금지한다. §2.2는 팩에 필요한 patcher mod를 포함하도록 한다. ZIP에 이미 생성된 셰이더 소스가 들어 있다고 해서 런처에서 이를 재배포할 권한까지 확보한 것은 아니다. 이 파일들을 자체 업데이트 서버에 올려서는 안 된다. 라이선스 원문은 두 셰이더 폴더 안에 각각 있다.

345개 개별 모드의 라이선스를 전부 판정하지 않았다. 현재 catalog는 ID를 기록한 설치 목록이며 재배포 허가 목록이 아니다. 자동 설치 시 API의 `allowModDistribution`, file availability, download URL과 제공되는 해시를 확인한다. 저작자가 third-party distribution을 허용하지 않은 파일은 자동 다운로드를 중단하고 해당 공식 파일 페이지를 안내하거나 사용자가 적법하게 받은 로컬 파일을 검사하여 가져온다. 다운로드 URL을 추측하거나 제삼자의 API 키, 비공식 미러로 제한을 우회하지 않는다.

## CurseForge 자동 설치와 외부 준비 사항

1. 런처 개발자의 CurseForge API 신청과 승인이 필요하다. API 조회에 `x-api-key` 헤더를 사용한다. [신청 안내](https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key)
2. 공식 API `GET /v1/mods/{projectID}/files/{fileID}` 또는 files batch 조회에서 실제 파일명, 길이, hashes, downloadUrl을 받는다. `GET /v1/mods/{projectID}`에서 distribution 정책을 확인한다. 반환된 file/mod ID가 요청과 일치하는지도 검사한다. [공식 REST 문서](https://docs.curseforge.com/rest-api/)
3. 2026-07-16부터 `edge.forgecdn.net` 직접 다운로드에도 유효한 API 키가 요구된다. header 인증을 사용하고 키가 URL, 로그, renderer에 나타나지 않게 한다. 401을 키 설정/승인 문제로 분명히 표시한다. [2026-06-10 공식 변경 공지](https://blog.curseforge.com/introducing-api-key-authentication-for-curseforge-file-downloads/)
4. API 키는 Electron main process에서만 사용하고 개발자 개인 로컬 테스트 자격증명은 Windows DPAPI 기반 safeStorage로 보호한다. 운영자 키를 EXE에 포함하거나 모든 이용자에게 배포하는 방안은 승인 없이 사용하지 않는다. 약관 §2.2는 키의 제삼자 공개를 제한하고 §3.1은 데이터 캐싱 및 신원 은폐 proxy 등을 제한한다. 배포용 키 전달/다운로드 서비스 설계는 승인된 integration 조건을 확인해야 한다. safeStorage는 보관 보호이며 키 공유 권한을 부여하지 않는다. [CurseForge API 약관](https://support.curseforge.com/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions)
5. 각 다운로드는 임시 파일에 기록한 뒤 공식 파일 해시와 길이를 검사한다. 검증 완료 후 instance에 교체하고, 기존 관리 파일은 rollback 사본을 유지한다. 유효한 기존 파일은 다시 다운로드하지 않는다. 사용자 `saves`, screenshots, options, 개인 JourneyMap 데이터는 업데이트 삭제 목록에 넣지 않는다.
6. 모드팩 ZIP을 author/CurseForge에서 받아 설치할 때도 자체 catalog의 SHA-256과 비교한다. 새 버전으로 운영자가 catalog를 변경하려면 출처, manifest, 라이선스, override 정책을 다시 검토한다. 공식 팩의 버전 변경과 자체 서버 패치는 별도의 버전 정보를 사용한다.

API 키가 아직 없으면 installer와 해시/rollback 로직의 단위 검증, local ZIP import, Minecraft/Java/NeoForge 준비까지 개발할 수 있다. 실제 모드 345개 다운로드, 실제 정품 계정 로그인 및 게임 구동은 해당 외부 조건을 갖추고 끝까지 테스트한 이후에만 완료라고 보고해야 한다.

## 구현 및 검증 상태

`src/main/modpack.ts`에는 검증된 로컬 ZIP/캐시 선택, 공식 API를 통한 ZIP 자동 획득, 345개 파일의 batch metadata 조회, 종류별 설치 경로 지정, 공식 SHA-1 검사 및 로컬 SHA-256 기록, 최대 4개 병렬 다운로드, 기존 설정 보존, 관리 파일에 한정한 삭제와 쓰기 전 복구 journal을 구현했다. 실행 중 실패하면 변경을 복구하고, 재시작 시 `.cobble/pack-journal.json`을 확인해 중단된 설치를 복구한다. 백업 또는 복구 대상이 예상 해시와 다르면 사용자의 변경 파일과 원본 백업을 보존한다.

`src/main/download.ts`는 각 redirect에서 지정된 호스트 목록을 적용하고 HTTPS를 요구한다. 다른 origin으로 이동할 때 계정 인증 헤더를 제거하며 CurseForge 키는 공식 CurseForge 호스트 사이에만 전달한다. Range 206의 offset/end/total, 서버의 Range 미지원 200, stale partial에 대한 416, 스트림 중단 이어받기와 완성된 캐시의 해시를 검사한다.

`tests/modpack.test.ts`, `tests/download.test.ts`의 총 26개 검증이 통과했다. 실제 제공된 ZIP의 해시/manifest/entry 분석은 실제 파일로 테스트했다. 네트워크 제한, 다운로드 오류, 공식 API 응답에 따른 자동 ZIP 설치, 파일 보호, 중단 복구는 통제된 가짜 API/CDN 응답과 실제 임시 디스크 파일로 테스트했다. 승인된 CurseForge 키로 실제 345개 파일 전체를 다운로드한 테스트와 전체 모드팩 게임 구동 테스트는 아직 별도의 검증 단계이다.
