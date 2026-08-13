import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Run } from '../types';
import StatusBadge from './StatusBadge';

function ago(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default function RunTable({ runs }: { runs: Run[] }) {
  if (!runs.length) return <div className="empty">暂无构建记录</div>;
  return <div className="table-wrap"><table><thead><tr><th>流水线</th><th>项目 / 分支</th><th>状态</th><th>触发</th><th>时间</th><th /></tr></thead><tbody>{runs.map((run) => <tr key={`${run.projectId || 0}-${run.id}`}>
    <td><div className="run-name">{run.displayTitle || run.name}</div><span className="muted">#{run.runNumber} · {run.name}</span></td>
    <td>{run.projectId ? <Link className="project-link" to={`/projects/${run.projectId}`}>{run.projectName}</Link> : null}<div className="branch">{run.headBranch || '—'}</div></td>
    <td><StatusBadge status={run.status} conclusion={run.conclusion} /></td>
    <td><span className="mono">{run.event}</span></td><td>{ago(run.createdAt)}</td>
    <td><a className="icon-link" href={run.htmlUrl} target="_blank" rel="noreferrer" title="在 GitHub 打开"><ExternalLink size={16} /></a></td>
  </tr>)}</tbody></table></div>;
}
