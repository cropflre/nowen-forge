import type { ReactNode } from 'react';
import { Activity, Archive, Boxes, GitBranch, Hammer, Moon, Rocket, Send, Settings, Sun } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../theme';

const nav = [
  { to: '/', label: '仪表盘', icon: Activity },
  { to: '/projects', label: '项目', icon: Boxes },
  { to: '/runs', label: '构建记录', icon: GitBranch },
  { to: '/publish', label: '一键发布', icon: Send },
  { to: '/releases', label: '发布中心', icon: Rocket },
  { to: '/artifacts', label: '制品中心', icon: Archive },
  { to: '/settings', label: '设置', icon: Settings }
];

export default function Layout({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Hammer size={19} /></span><div><strong>Nowen Forge</strong><small>BUILD & RELEASE</small></div></div>
      <nav>{nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><span className="dot online" />GitHub Actions 执行引擎</div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div><span className="eyebrow">NOWEN ECOSYSTEM</span></div>
        <div className="topbar-actions">
          <button
            type="button"
            className="ghost-button theme-toggle"
            onClick={toggleTheme}
            aria-label={isLight ? '切换到夜间模式' : '切换到日间模式'}
            aria-pressed={isLight}
            title={isLight ? '当前为日间模式，点击切换夜间模式' : '当前为夜间模式，点击切换日间模式'}
          >
            {isLight ? <Sun size={16} /> : <Moon size={16} />}
            <span className="theme-toggle-label">{isLight ? '日间模式' : '夜间模式'}</span>
          </button>
          <a className="ghost-button" href="https://github.com/cropflre/nowen-forge" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>;
}
