import { BrandMark } from './BrandMark';

interface ConnectionScreenProps {
  onRetry: () => void;
  retrying: boolean;
}

export function ConnectionScreen({ onRetry, retrying }: ConnectionScreenProps) {
  return (
    <div className="login-screen" role="alert">
      <div className="login-card connection-card">
        <span className="login-mark">
          <BrandMark />
        </span>
        <p className="login-kicker">Connection lost</p>
        <h1>无法连接 Kikoeru Next</h1>
        <p className="login-hint">
          电脑上的服务可能已关闭、进入睡眠，或当前设备与电脑不在同一网络。
        </p>
        <ul className="connection-hints">
          <li>确认电脑端 Kikoeru Next 正在运行。</li>
          <li>局域网访问：手机与电脑连接同一 Wi-Fi，并使用设置页显示的地址。</li>
          <li>使用 Tailscale 时，确认手机与电脑两端都已连接。</li>
          <li>电脑关机或休眠后无法连接，本应用不会远程唤醒电脑。</li>
        </ul>
        <button
          type="button"
          className="btn btn-primary login-submit"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? '正在重连…' : '重新连接'}
        </button>
      </div>
    </div>
  );
}
