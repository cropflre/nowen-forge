import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Project } from '../types';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { api.projects().then((r) => setProjects(r.projects)).catch((e) => setError(e.message)); }, []);
  return <section><div className="page-head"><div><span className="eyebrow">PROJECTS</span><h1>项目</h1><p>Nowen Forge 当前管理的构建项目</p></div></div>{error && <div className="alert error">{error}</div>}<div className="project-grid large">{projects.map((project) => <Link className="project-card" key={project.id} to={`/projects/${project.id}`}><div className="project-top"><div className={`project-mark kind-${project.kind}`}>{project.displayName.slice(0, 1)}</div><div><h3>{project.displayName}</h3><span>{project.owner}/{project.repo}</span></div></div><p>{project.description}</p><div className="chips"><span>{project.kind}</span>{project.workflowHints.map((hint) => <span key={hint}>{hint}</span>)}</div></Link>)}</div></section>;
}
