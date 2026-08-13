import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Github, LoaderCircle, LogOut } from 'lucide-react';
import { api, type GitHubAuthStatus } from '../api';
import '../auth.css';

type DeviceFlow = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export default function GitHubAuthControl({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null);
  const [device, setDevice] = useState<DeviceFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const stoppedRef = useRef(false);

  async function refresh() {
    try {
      setStatus(await api.githubAuthStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取 GitHub 登录状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    stoppedRef.current = false;
    void refresh();
    return () => { stoppedRef.current = true; };
  }, []);

  useEffect(() => {
    if (!device) return;
    let timer = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await api.githubDevicePoll(device.flowId);
        if (result.status === 'authorized') {
          setDevice(null);
          setError('');
          await refresh();
          return;
        }
        timer = window.setTimeout(poll, Math.max(5, result.interval || device.interval) * 1000);
      } catch (e) {
        setDevice(null);
        setError(e instanceof Error ? e.message : 'GitHub 授权失败');
      }
    };

    timer = window.setTimeout(poll, Math.max(5, device.interval) * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [device]);

  async function login() {
    if (!status?.loginMode) {
      setError('服务端还没有配置 GitHub OAuth。请先设置 GITHUB_OAUTH_CLIENT_ID。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (status.loginMode === 'web') {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        const { authorizeUrl } = await api.githubWebLogin(returnTo);
        window.location.assign(authorizeUrl);
        return;
      }

      const popup = window.open('about:blank', 'nowen-forge-github-login');
      const flow = await api.githubDeviceStart();
      setDevice(flow);
      try { await navigator.clipboard?.writeText(flow.userCode); } catch { /* clipboard permission is optional */ }
      if (popup) popup.location.href = flow.verificationUri;
      else window.open(flow.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitHub 登录启动失败');
    } finally {
      if (!stoppedRef.current) setLoading(false);
    }
  }

  async function logout() {
    setLoading(true);
    setError('');
    try {
      setStatus(await api.githubLogout());
    } catch (e) {
      setError(e instanceof Error ? e.message : '退出 GitHub 登录失败');
    } finally {
      setLoading(false);
    }
  }

  const authenticated = Boolean(status?.authenticated);
  const oauthUser = status?.mode === 'oauth' ? status.user : null;

  if (compact) {
    return <>
      <button className={`github-auth-compact ${authenticated ? 'connected' : ''}`} onClick={() => void login()} disabled={loading || authenticated} title={authenticated ? 'GitHub 已连接' : '登录 GitHub'}>
        {loading ? <LoaderCircle className="spin" size={16} /> : oauthUser?.avatarUrl ? <img src={oauthUser.avatarUrl} alt="" /> : <Github size={17} />}
        <span>{oauthUser ? `@${oauthUser.login}` : authenticated ? 'GitHub 已连接' : '登录 GitHub'}</span>
      </button>
      {device && <DeviceModal device={device} onClose={() => setDevice(null)} />}
    </>;
  }

  return <div className="github-auth-control">
    <div className="github-auth-status">
      {oauthUser?.avatarUrl ? <img src={oauthUser.avatarUrl} alt="" /> : <span className="github-auth-icon"><Github size={20} /></span>}
      <div>
        <strong>{oauthUser ? oauthUser.name || oauthUser.login : authenticated ? 'GitHub 已连接' : '尚未登录 GitHub'}</strong>
        <small>{oauthUser ? `@${oauthUser.login} · OAuth` : status?.mode === 'token' ? '使用服务端 GITHUB_TOKEN 兜底' : status?.loginMode === 'web' ? '支持浏览器 OAuth 登录' : status?.loginMode === 'device' ? '支持 Device Flow 登录' : '需要配置 OAuth Client ID'}</small>
      </div>
    </div>
    <div className="github-auth-actions">
      {authenticated && <span className="setting-ok"><CheckCircle2 size={15} />已认证</span>}
      {status?.mode === 'oauth'
        ? <button className="button secondary compact-button" onClick={() => void logout()} disabled={loading}><LogOut size={15} />退出登录</button>
        : <button className="button primary compact-button" onClick={() => void login()} disabled={loading || !status?.loginMode}>{loading ? '处理中…' : authenticated ? '切换为 GitHub 登录' : '登录 GitHub'}</button>}
    </div>
    {error && <div className="github-auth-error">{error}</div>}
    {device && <DeviceModal device={device} onClose={() => setDevice(null)} />}
  </div>;
}

function DeviceModal({ device, onClose }: { device: DeviceFlow; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal github-device-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">GITHUB LOGIN</span><h2>登录 GitHub</h2></div><button className="close" onClick={onClose}>×</button></div>
      <p className="muted">GitHub 登录页已经打开。输入下面的设备码完成授权；设备码已尝试复制到剪贴板。</p>
      <button className="github-device-code" onClick={() => void navigator.clipboard?.writeText(device.userCode)}>{device.userCode}</button>
      <div className="github-device-wait"><LoaderCircle className="spin" size={16} />等待 GitHub 授权…</div>
      <div className="modal-actions"><a className="button secondary" href={device.verificationUri} target="_blank" rel="noreferrer">重新打开 GitHub</a><button className="button primary" onClick={onClose}>关闭</button></div>
    </div>
  </div>;
}
