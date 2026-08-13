export default function StatusBadge({ status, conclusion }: { status: string; conclusion?: string | null }) {
  const value = status === 'completed' ? (conclusion || 'completed') : status;
  const label: Record<string, string> = { success: '成功', failure: '失败', cancelled: '已取消', in_progress: '运行中', queued: '排队中', waiting: '等待中', skipped: '跳过', completed: '完成', neutral: '中性', timed_out: '超时' };
  return <span className={`status status-${value}`}>{status !== 'completed' && <span className="pulse" />}{label[value] || value}</span>;
}
