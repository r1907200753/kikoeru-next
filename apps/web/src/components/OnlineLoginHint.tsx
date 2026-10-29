import { GlobeIcon } from '../icons';

export function OnlineLoginHint({
  message = '登录后即可同步我的评价、进度与播放列表。',
  onOpenSettings,
}: {
  message?: string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="online-login-hint">
      <span className="online-login-icon">
        <GlobeIcon />
      </span>
      <div>
        <h2>需要登录 asmr.one</h2>
        <p>{message}</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
        前往设置登录
      </button>
    </div>
  );
}
