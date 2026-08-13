import type { ReactNode } from 'react';
import { Activity, Archive, Boxes, GitBranch, Hammer, Rocket, Send, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

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
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Hammer size={19} /></span><div><strong>Nowen Forge</strong><small>BUILD & RELEASE</small></div></div>
      <nav>{nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><span className="dot online" />GitHub Actions 执行引擎</div>
    </aside>
    <main className="main"><header className="topbar"><div><span className="eyebrow">NOWEN ECOSYSTEM</span></div><a className="ghost-button" href="https://github.com/cropflre/nowen-forge" target="_blank" rel="noreferrer">GitHub</a></header><div className="content">{children}</div></main>
  </div>;
}
