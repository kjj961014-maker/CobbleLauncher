# Microsoft·CurseForge 연결 준비

2026년 10월 9일 확인. 이 문서는 아직 서비스 등록을 하지 않은 **런처 운영자**를 위한 안내입니다. Microsoft 앱 등록과 CurseForge API 신청은 서로 별개이며, 게임을 플레이하는 계정의 Minecraft Java Edition 사용 권한도 필요합니다.

일반 이용자가 Azure 앱을 매번 등록하는 방식으로 배포하지 않습니다. 운영자가 승인받은 Microsoft 앱의 공개 Client ID를 최종 빌드에 넣고, 이용자는 자신의 Minecraft 계정으로 로그인하는 구성을 사용합니다. CurseForge 다운로드 연결은 별도의 승인된 배포 설계를 준비해야 합니다.

## 계속 비용이 발생하나요?

| 항목 | 현재 준비할 때의 비용 범위 |
| --- | --- |
| Microsoft 앱 등록·기본 로그인 | Microsoft는 Entra ID Free를 제공하며 Azure·Microsoft 365 같은 클라우드 구독에 포함한다고 설명합니다. 이 런처의 기본 공개 클라이언트 로그인에는 P1·P2·Suite의 추가 기능을 사용하지 않습니다. [Microsoft 공식 요금 안내](https://www.microsoft.com/en-us/security/business/microsoft-entra-pricing) |
| Azure 가입·추가 리소스 | 공식 가입 화면에서 무료 시작 옵션, 본인 확인과 구독 조건을 확인합니다. VM·데이터베이스·스토리지 같은 유료 리소스를 별도로 사용하면 해당 서비스 요금이 적용될 수 있습니다. 현재 작업에서는 유료 계정 가입이나 결제를 진행하지 않았습니다. |
| CurseForge API | 신청과 검토 단계에서 사용 조건을 확인합니다. 공개 약관 §2.3은 서비스가 정하는 사용량 기준을 넘으면 비용 조건이 포함될 수 있는 별도 서면 라이선스 계약을 요구할 수 있다고 규정합니다. 영구 무료나 특정 무료 호출 한도를 이 문서에서 약속하지 않습니다. [CurseForge API 약관](https://support.curseforge.com/support/solutions/articles/9000207405-curseforge-3rd-party-api-terms-and-conditions) |
| 업데이트·게임 서버 운영 | 업데이트 파일 저장 공간, 다운로드 트래픽, 도메인과 게임 서버 비용은 선택한 호스팅 계약에 따라 따로 확인합니다. 현재 등록 안내를 작성하면서 호스팅을 구매하거나 결제하지 않았습니다. |

먼저 무료로 시작할 수 있는 계정 옵션과 앱 등록 권한을 확인하고, 실제로 유료 서비스나 계약이 필요해지는 단계에서 비용 조건을 확인하면 됩니다.

## 1. Microsoft 앱을 등록할 계정 준비

1. [Microsoft 공식 앱 등록 안내](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)의 사전 조건부터 확인합니다. 현재 문서는 **활성 구독이 있는 Azure 계정**, **Application Developer 이상 권한**, **workforce 또는 external 테넌트**를 명시합니다. 기존 Default Directory를 사용할 수 있습니다. 테넌트는 앱 등록과 권한을 관리하는 조직 단위입니다.
2. 이미 Azure/Entra 환경이 있다면 그 테넌트에 앱을 만들 권한이 있는지 확인합니다. 권한이 없으면 해당 테넌트 관리자에게 앱 등록 권한을 요청합니다.
3. 환경이 없다면 공식 문서가 연결하는 [Azure 계정 시작 페이지](https://azure.microsoft.com/free/)에서 현재 제공되는 계정 옵션과 가입 조건을 확인합니다. 개인 Microsoft 계정만 가지고 있다는 사실이 위 사전 조건을 자동으로 충족한다는 뜻은 아닙니다. 이 런처를 위해 VM·데이터베이스·유료 호스팅 서비스를 별도로 생성할 작업은 없습니다.

앱을 관리하는 운영자 계정과 실제 Minecraft를 플레이하는 계정은 역할이 다릅니다. 앱 등록을 끝내도 게임 구매·사용 권한이 자동으로 생기지 않습니다.

## 2. 앱 등록과 Client ID 확인

1. [Microsoft Entra 관리 센터](https://entra.microsoft.com/)에 로그인합니다.
2. 여러 테넌트가 표시되면 운영자가 앱을 관리할 테넌트로 전환합니다.
3. **Entra ID → App registrations → New registration**으로 이동합니다.
4. 이름에 `Cobble Launcher`처럼 이용자가 알아볼 수 있는 이름을 입력합니다.
5. 지원 계정 유형에서 **개인 Microsoft 계정 사용이 포함된 옵션**을 선택합니다. 이 런처는 개인 계정용 인증 엔드포인트를 사용하므로, 개인 계정 전용 옵션을 사용할 수 있습니다. 조직과 개인 계정을 함께 지원하는 옵션도 개인 계정을 포함합니다.
6. 등록을 마친 뒤 개요에서 **Application (client) ID**를 복사합니다. `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 형태입니다. Minecraft 승인 절차에서 요구될 때 확인할 수 있도록 테넌트 ID도 운영자 기록에 남깁니다.

Client ID는 앱을 식별하는 공개 값입니다. 런처 설정에 입력할 값은 이 ID이며, 계정 이메일이나 로그인 비밀번호가 아닙니다. [계정 유형과 ID 확인의 공식 설명](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

## 3. 데스크톱 로그인 반환 주소 등록

1. 등록한 앱의 **인증 → 플랫폼 추가 → 모바일 및 데스크톱 애플리케이션**으로 이동합니다. 이 앱은 설치형 데스크톱 공개 클라이언트입니다. [데스크톱 앱 구성 안내](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)
2. 사용자 지정 리디렉션 URI에 다음 값을 등록하고 저장합니다.

   ```text
   http://localhost/callback
   ```

3. 경로의 `/callback`까지 정확하게 입력합니다. 현재 런처는 로그인할 때 임시 포트를 선택하여 `http://localhost:<임시 포트>/callback`으로 돌아옵니다. Microsoft는 localhost 리디렉션을 비교할 때 포트를 무시하지만 경로는 구분하므로, 포트별 URI를 여러 개 등록할 필요가 없습니다. [공식 localhost 예외와 경로 규칙](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions)
4. **클라이언트 비밀은 생성하거나 런처에 넣지 않습니다.** 현재 구현은 S256 PKCE와 무작위 state 검증을 사용하며, 별도 Microsoft 팝업과 외부 브라우저 대체 경로 모두 같은 loopback 반환 주소를 사용합니다. Microsoft는 데스크톱 앱의 PKCE 사용을 권장하며, 공개 클라이언트에 클라이언트 비밀을 넣지 않도록 명시합니다. [공식 인증 코드·PKCE 설명](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

`http://localhost/callback`은 위 Azure 설정 칸에 저장하는 값이며, 브라우저 주소창에 입력해 방문하는 사이트가 아닙니다. 로그인 결과는 같은 PC에서 해당 시도 동안만 열린 임시 포트의 런처로 전달됩니다. 운영자가 공개 웹사이트에서 `/callback` 서버를 호스팅할 작업은 없습니다. Microsoft 오류에 `redirect_uri is not valid`가 표시되면 **모바일 및 데스크톱 애플리케이션** 플랫폼에 이 주소가 저장됐는지 확인합니다.

## 4. Minecraft Services 앱 승인

Entra에 앱을 등록하는 단계와 Minecraft Services에서 그 앱의 접근을 허용하는 단계는 구분됩니다. 앱 등록만 끝난 상태에서는 Microsoft 로그인이 진행되어도 Minecraft 인증에서 접근 거부가 발생할 수 있습니다.

1. 아래의 런처 입력 절차로 Client ID를 저장하고, 운영자의 정품 Minecraft 계정으로 로그인을 한 번 시도해 반환 주소와 오류를 확인합니다.
2. [Minecraft 앱 ID 검토 링크](https://aka.ms/mce-reviewappid)를 직접 엽니다. 런처와 앱의 실제 정보를 화면에 표시되는 안내에 따라 제출합니다. 앱의 Client ID, 테넌트 ID, 런처의 용도와 공개 설명을 확인할 수 있게 준비합니다.
3. Microsoft의 승인 또는 추가 정보 요청을 확인한 뒤 같은 앱 ID로 다시 시험합니다. 다른 런처의 Client ID를 가져와 사용하지 않습니다.

이 검토 링크는 조사 당시 Microsoft Forms로 이동했지만, 자동 읽기 도구에서는 양식 내용을 열지 못했습니다. 따라서 현재 양식의 정확한 항목, 개인 운영자의 승인 가능 여부, 처리 기간을 이 문서에서 확정하지 않습니다. 실제 양식과 Microsoft의 회신을 따릅니다. 이 링크를 안내하는 [HeliosLauncher의 인증 문서](https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md)를 참고할 수 있으나, 현재 런처의 PKCE 방식에는 그 문서의 비밀 생성·내장 브라우저 설정을 적용하지 않습니다.

## 5. CurseForge API 신청

1. [CurseForge 공식 API 신청 안내](https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key)를 엽니다.
2. 안내 문서 안의 신청 양식 링크를 따라갑니다. Minecraft용 외부 런처·모드팩 도구의 신청 경로를 사용합니다.
3. 운영자 연락처, 실제 프로젝트 설명과 링크, 예상 API 사용 방식을 안내에 따라 작성하고 제삼자 개발자 API 약관을 확인합니다. Cobble Launcher의 모드팩 설치, 파일 검증, 다운로드·캐시 방식과 일반 이용자 배포 계획을 정확하게 설명합니다.
4. Overwolf의 검토 결과와 연락을 확인합니다. 공식 문서는 검토·승인 후 고유 키를 발급하고 이메일로 연락한다고 설명합니다. 승인 전에는 다른 프로젝트의 키를 사용하지 않습니다.
5. 개발자 본인에게 발급·승인된 키를 아래의 런처 설정에 직접 입력하여 로컬 설치 시험을 진행합니다.

공식 공지에 따르면 **2026년 7월 16일부터 `edge.forgecdn.net` 직접 파일 다운로드에도 유효한 API 키가 필요**합니다. API 조회만 키를 넣고 파일 다운로드에서 키를 생략하면 실패할 수 있습니다. 현재 런처는 공식 CurseForge 대상에 `x-api-key` 헤더를 사용합니다. 키가 포함된 URL을 만들어 공유하지 않습니다. [2026년 6월 10일 공식 다운로드 인증 공지](https://blog.curseforge.com/introducing-api-key-authentication-for-curseforge-file-downloads/)

API 키가 있어도 저작자가 제삼자 다운로드를 차단한 파일은 자동으로 가져올 수 없습니다. 런처는 저작자의 배포 설정과 공식 API가 제공하는 파일 정보를 확인합니다. [CurseForge의 프로젝트 배포 설정 설명](https://support.curseforge.com/support/solutions/articles/9000207877-project-distribution-toggle)

## 6. 현재 런처에 입력할 값

1. Cobble Launcher에서 **설정 → 계정 및 연결**을 엽니다.
2. **Microsoft 공식 로그인 → 애플리케이션 Client ID**에 운영자가 등록한 앱의 Client ID를 붙여넣습니다.
3. **CurseForge 다운로드 연결 → CurseForge API 키**에 개발자 본인의 승인된 키를 직접 입력합니다. 이 칸은 비밀번호 형태로 가려집니다.
4. 오른쪽 위의 **설정 저장**을 누릅니다. CurseForge 영역에 **키 등록됨**이 표시되는지 확인합니다. 저장한 키는 화면에 다시 표시되지 않습니다.
5. **계정 → Microsoft 계정 로그인**에서 Minecraft Java Edition을 사용할 수 있는 개인 Microsoft 계정으로 로그인합니다. 비밀번호는 Microsoft 브라우저 화면에서 입력합니다.
6. **설정 → 게임 환경**에서 설치 폴더·모드팩 ZIP·메모리를 확인하고 홈에서 설치를 진행합니다. 승인된 API 연결을 준비하면 런처의 공식 모드팩 ZIP 자동 다운로드 경로도 사용할 수 있습니다.

**API 키, Microsoft 비밀번호, 로그인 토큰은 이 채팅·스크린샷·소스 저장소에 보내지 않습니다.** Client ID와 업데이트 서명 공개키는 공개 설정값이지만, CurseForge API 키와 업데이트 서명 개인키는 별도로 보호합니다. 현재 로컬 키 보관 기능은 디스크에 저장된 자격증명을 보호하는 기능입니다.

## 7. 일반 이용자에게 배포하기 전

Microsoft 쪽은 운영자가 승인받은 Client ID를 `resources/deployment.json`의 `microsoftClientId`에 넣고 최종 설치 파일을 다시 빌드합니다. 그러면 새 이용자는 앱 등록 없이 자신의 Microsoft 계정으로 로그인할 수 있습니다. 서버 주소, 서명된 업데이트 URL과 공개키도 운영자가 준비한 실제 값으로 배포 설정에 넣습니다.

CurseForge 키는 그 파일이나 EXE에 넣어 일반 이용자에게 전달하지 않습니다. 공개 API 약관 §2.2는 키의 양도와 제삼자 공유를 제한합니다. §3.1의 프록시·캐시 관련 조건도 실제 배포 설계에 적용될 수 있으므로, **일반 이용자에게 자동 다운로드를 제공할 키 전달·다운로드·캐시 방식을 신청 단계에 설명하고 CurseForge가 허용한 통합 조건을 확인**해야 합니다. 단순히 키를 암호화하거나 서버에 옮기는 작업으로 배포 권한을 얻는 것은 아닙니다. [CurseForge 제삼자 API 약관](https://support.curseforge.com/support/solutions/articles/9000207405-curseforge-3rd-party-api-terms-and-conditions)

따라서 현재 설정의 API 키 입력 칸은 승인된 개발자 본인의 로컬 검증에 사용합니다. 일반 이용자에게 API 신청을 요구하는 방식을 최종 제품 흐름으로 확정하지 않습니다. 운영자 앱 승인, CurseForge 배포 통합 조건, 실제 파일 다운로드·게임 실행 시험을 마치면 일반 이용자용 배포 구성을 완성할 수 있습니다.

## 문제가 생겼을 때

| 표시 또는 증상 | 확인할 내용 |
| --- | --- |
| 앱 등록 메뉴가 없거나 등록 권한 오류 | Azure/Entra 계정의 테넌트와 앱 등록 권한을 확인합니다. |
| `AADSTS50011` 또는 반환 주소 오류 | 데스크톱 플랫폼에 `http://localhost/callback`이 정확히 등록되어 있는지 확인합니다. |
| Microsoft 화면 뒤 Minecraft 접근 거부 | 운영자의 앱 ID 승인, Xbox 프로필 및 계정 권한을 확인합니다. |
| Minecraft 소유권·프로필 없음 | 로그인 계정의 Java Edition 사용 권한과 Minecraft 프로필을 확인합니다. |
| CurseForge API·다운로드 `401`/`403` | 키가 본인 프로젝트에 발급·승인된 값인지, 다운로드 사용 범위도 승인되었는지 확인합니다. |
| 특정 모드의 자동 다운로드 거부 | 해당 저작자의 제삼자 배포 설정과 공식 파일 상태를 확인합니다. |

오류를 공유할 때는 오류 문구와 어느 단계에서 발생했는지만 전달합니다. 비밀번호나 키가 들어간 URL·토큰 전체를 복사하지 않습니다.
