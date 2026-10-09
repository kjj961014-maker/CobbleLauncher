import type { LauncherState } from '../shared/types';
import { ExternalLink, Info } from 'lucide-react';

export function AuthHelp({ auth, external }: { auth: LauncherState['auth']; external: (url: string) => void }) {
  if (auth.status !== 'error' || !auth.code || auth.code === 'CANCELLED') return null;
  const guidance = {
    APP_APPROVAL: {
      title: '앱 사용 승인과 계정 권한을 확인해 주세요',
      text: 'Microsoft 로그인 뒤 Minecraft 서비스에서 접근을 거부했습니다. 운영자가 이미 승인 신청을 제출했다면 회신을 기다려 주세요. 친구들은 별도로 신청할 필요가 없습니다. 승인 후에도 계속되면 운영자에게 문의해 주세요.',
      label: '운영자용 승인 안내', url: 'https://aka.ms/mce-reviewappid',
    },
    CONFIGURATION: {
      title: '런처의 로그인 연결 설정이 필요해요',
      text: '운영자는 설정의 Client ID와 Microsoft 앱의 반환 주소를 확인해 주세요. 친구들은 운영자가 준비한 최신 런처를 사용하면 됩니다.',
    },
    SESSION_EXPIRED: {
      title: 'Microsoft 계정으로 다시 로그인해 주세요',
      text: '만료된 로그인 연결을 해제했습니다. 다시 로그인하면 설치된 게임을 그대로 사용할 수 있습니다.',
    },
    NETWORK: { title: '인터넷 연결을 확인한 뒤 다시 시도해 주세요', text: '일시적인 연결 오류로 기존 계정 연결을 지우지 않습니다. 연결이 돌아오면 다시 시도해 주세요.' },
    TIMEOUT: { title: '로그인 시간이 초과되었어요', text: '다시 로그인을 시작해 주세요. 팝업에서 진행되지 않으면 로그인 주소 복사로 Chrome 또는 Edge에서 계속할 수 있습니다.' },
    BROWSER: { title: '다른 로그인 창으로 다시 시도해 주세요', text: '로그인을 다시 누른 뒤 로그인 주소를 복사해 Chrome 또는 Edge에서 열어 주세요.' },
    XBOX_PROFILE: { title: 'Xbox 프로필을 준비해 주세요', text: '같은 Microsoft 계정의 Xbox 프로필을 만든 뒤 다시 로그인해 주세요.', label: 'Microsoft 계정 관리', url: 'https://www.minecraft.net/ko-kr/msaprofile' },
    XBOX_FAMILY: { title: '보호자의 계정 설정 확인이 필요해요', text: 'Microsoft 가족의 보호자 계정에서 Xbox 이용 권한을 확인한 뒤 다시 로그인해 주세요.' },
    OWNERSHIP: { title: 'Java Edition을 사용할 계정인지 확인해 주세요', text: '게임을 소유하거나 유효한 이용 권한이 있는 Microsoft 계정으로 로그인하고, Minecraft 프로필을 만들어 주세요.', label: 'Minecraft 계정 관리', url: 'https://www.minecraft.net/ko-kr/msaprofile' },
    OAUTH: { title: '표시된 인증 안내를 확인해 주세요', text: '요청이 너무 많다는 안내라면 잠시 기다려 주세요. 그 외에는 새 로그인 창에서 계정과 이용 권한을 확인해 주세요.' },
    RESPONSE: { title: '인증 응답을 확인하지 못했어요', text: '잠시 후 다시 시도해 주세요. 같은 문제가 계속되면 설정의 파일 및 진단에서 로그를 확인할 수 있습니다.' },
  }[auth.code];
  if (!guidance) return null;
  return <div className="auth-help-card">
    <h3><Info size={17} />{guidance.title}</h3>
    <p>{guidance.text}</p>
    {'url' in guidance && <button className="text-button" onClick={() => external(guidance.url!)}>{guidance.label}<ExternalLink size={14} /></button>}
  </div>;
}
