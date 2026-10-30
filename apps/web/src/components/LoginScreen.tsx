import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loginWithPassword } from '../api';
import { LockIcon } from '../icons';
import { BrandMark } from './BrandMark';

interface LoginScreenProps {
  hasPassword: boolean;
  onSuccess: () => void;
}

export function LoginScreen({ hasPassword, onSuccess }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await loginWithPassword(password);
      setPassword('');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <span className="login-mark">
          <BrandMark />
        </span>
        <p className="login-kicker">KIKOERU NEXT</p>
        <h1>需要访问密码</h1>
        <p className="login-hint">
          已开启局域网访问，请在本机或手机浏览器输入访问密码后继续。
        </p>
        <label className="login-field">
          <span>
            <LockIcon />
            访问密码
          </span>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={hasPassword ? '请输入访问密码' : '尚未设置访问密码'}
            autoComplete="current-password"
            aria-label="访问密码"
            disabled={busy || !hasPassword}
          />
        </label>
        {error ? (
          <div className="notice notice--error notice--inline" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary login-submit"
          disabled={busy || !password || !hasPassword}
        >
          {busy ? '登录中…' : '进入曲库'}
        </button>
        <p className="login-foot">
          {hasPassword
            ? '密码只在本机校验，不会上传到任何服务器。同一 Wi-Fi 下的设备登录一次后会保持约 30 天。'
            : '尚未设置访问密码，请回到运行服务的电脑，在设置中开启局域网访问并设置密码。'}
        </p>
      </form>
    </div>
  );
}
