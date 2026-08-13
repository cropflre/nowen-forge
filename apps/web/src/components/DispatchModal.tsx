import { useEffect, useState } from 'react';
import type { Workflow } from '../types';

export default function DispatchModal({ workflow, branches, defaultBranch, onClose, onDispatch }: { workflow: Workflow | null; branches: string[]; defaultBranch: string; onClose: () => void; onDispatch: (ref: string, inputs: Record<string, string>) => Promise<void> }) {
  const [ref, setRef] = useState(defaultBranch);
  const [rawInputs, setRawInputs] = useState('{}');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { setRef(defaultBranch); setRawInputs('{}'); setError(''); }, [workflow, defaultBranch]);
  if (!workflow) return null;
  async function submit() {
    try {
      const parsed = JSON.parse(rawInputs);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Inputs 必须是 JSON 对象');
      const inputs = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
      setLoading(true); setError('');
      await onDispatch(ref, inputs);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '启动失败'); }
    finally { setLoading(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">RUN PIPELINE</span><h2>{workflow.name}</h2></div><button className="close" onClick={onClose}>×</button></div>
    <label>分支 / Tag</label><input list="branch-options" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main 或 v1.0.0" /><datalist id="branch-options">{branches.map((branch) => <option key={branch} value={branch} />)}</datalist>
    <label>Workflow inputs <span className="muted">（没有参数就保持 {}）</span></label><textarea value={rawInputs} onChange={(e) => setRawInputs(e.target.value)} rows={6} spellCheck={false} />
    {error && <div className="alert error">{error}</div>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={loading || !ref} onClick={submit}>{loading ? '启动中…' : '开始构建'}</button></div>
  </div></div>;
}
