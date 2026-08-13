import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import type { Workflow, WorkflowInput, WorkflowSchema } from '../types';

export default function DispatchModal({
  projectId,
  workflow,
  branches,
  tags,
  defaultBranch,
  onClose,
  onDispatch
}: {
  projectId: number;
  workflow: Workflow | null;
  branches: string[];
  tags: string[];
  defaultBranch: string;
  onClose: () => void;
  onDispatch: (ref: string, inputs: Record<string, string>) => Promise<void>;
}) {
  const [ref, setRef] = useState(defaultBranch);
  const [schema, setSchema] = useState<WorkflowSchema | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRef(defaultBranch);
    setSchema(null);
    setValues({});
    setError('');
    if (!workflow) return;
    let cancelled = false;
    setLoadingSchema(true);
    api.workflowSchema(projectId, workflow.id)
      .then((next) => {
        if (cancelled) return;
        setSchema(next);
        setValues(Object.fromEntries(next.inputs.map((input) => [input.name, input.defaultValue])));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '读取 Workflow 参数失败'))
      .finally(() => !cancelled && setLoadingSchema(false));
    return () => { cancelled = true; };
  }, [workflow, defaultBranch, projectId]);

  const missing = useMemo(() => schema?.inputs.filter((input) => input.required && !values[input.name]?.trim()).map((input) => input.name) || [], [schema, values]);
  if (!workflow) return null;

  async function submit() {
    if (!schema?.dispatchable) return;
    if (missing.length) { setError(`请填写必填参数：${missing.join('、')}`); return; }
    try {
      setLoading(true); setError('');
      const inputs = Object.fromEntries(schema.inputs.map((input) => [input.name, values[input.name] ?? '']));
      await onDispatch(ref, inputs);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '启动失败'); }
    finally { setLoading(false); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">RUN PIPELINE</span><h2>{workflow.name}</h2></div><button className="close" onClick={onClose}>×</button></div>

    <label>分支 / Tag</label>
    <input list="ref-options" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main 或 v1.0.0" />
    <datalist id="ref-options">{branches.map((branch) => <option key={`b-${branch}`} value={branch} />)}{tags.map((tag) => <option key={`t-${tag}`} value={tag} />)}</datalist>
    <div className="ref-summary"><span>{branches.length} 个分支</span><span>{tags.length} 个 Tag</span></div>

    {loadingSchema && <div className="schema-loading"><LoaderCircle className="spin" size={16} />正在解析 workflow_dispatch.inputs…</div>}
    {schema?.warnings.length ? <div className="workflow-warnings">{schema.warnings.map((warning) => <div key={warning}><TriangleAlert size={14} />{warning}</div>)}</div> : null}

    {schema && <div className="workflow-inputs">
      <div className="input-section-head"><strong>运行参数</strong><span>{schema.inputs.length ? '根据 Workflow YAML 自动生成' : '该流水线没有额外参数'}</span></div>
      {schema.inputs.map((input) => <WorkflowInputField key={input.name} input={input} value={values[input.name] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [input.name]: value }))} />)}
      {!schema.inputs.length && <div className="empty compact">无需填写 JSON，直接运行即可。</div>}
    </div>}

    {error && <div className="alert error">{error}</div>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={loading || loadingSchema || !ref || !schema?.dispatchable || missing.length > 0} onClick={submit}>{loading ? '启动中…' : schema?.dispatchable === false ? '不可手动运行' : '开始构建'}</button></div>
  </div></div>;
}

function WorkflowInputField({ input, value, onChange }: { input: WorkflowInput; value: string; onChange: (value: string) => void }) {
  const label = <>{input.name}{input.required && <span className="required"> *</span>}</>;
  if (input.type === 'choice') return <div className="workflow-field"><label>{label}</label><select value={value} onChange={(e) => onChange(e.target.value)}>{!input.required && !input.defaultValue && <option value="">请选择</option>}{input.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>{input.description && <small>{input.description}</small>}</div>;
  if (input.type === 'boolean') return <div className="workflow-field"><label>{label}</label><select value={value || 'false'} onChange={(e) => onChange(e.target.value)}><option value="false">false</option><option value="true">true</option></select>{input.description && <small>{input.description}</small>}</div>;
  return <div className="workflow-field"><label>{label}</label><input type={input.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={input.description || input.name} />{input.description && <small>{input.description}</small>}</div>;
}
