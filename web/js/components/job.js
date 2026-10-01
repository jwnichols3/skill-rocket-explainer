import { h, fmtMs } from '../dom.js';
import { api } from '../api.js';

/**
 * Live view of a background job: stage, progress, elapsed, log tail.
 * Polls until the job ends, then calls onEnd(job). Returns { el, stop }.
 */
export function jobView(jobId, { onEnd, onRetry } = {}) {
  const stage = h('span.job-stage', 'Starting…');
  const detail = h('span.muted.small');
  const elapsed = h('span.job-elapsed');
  const bar = h('div');
  const log = h('pre.job-log');
  let status = h('span.spinner');
  const actions = h('div.row', { style: { marginTop: '10px' } });
  const el = h('div.job.running', { 'data-job': jobId },
    h('div.job-head', status, stage, detail, elapsed),
    h('div.progress', bar),
    h('details', h('summary.small', 'Log'), log),
    actions);
  let timer = null, stopped = false;

  async function tick() {
    if (stopped) return;
    let job;
    try { job = await api(`/api/jobs/${jobId}`); } catch { timer = setTimeout(tick, 1500); return; }
    stage.textContent = job.stage;
    detail.textContent = job.detail ?? '';
    const start = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
    const end = job.endedAt ? new Date(job.endedAt).getTime() : Date.now();
    elapsed.textContent = fmtMs(end - start);
    bar.style.width = `${Math.round((job.progress ?? 0) * 100)}%`;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.textContent = job.log.slice(-200).join('\n');
    if (atBottom) log.scrollTop = log.scrollHeight;
    const active = job.status === 'queued' || job.status === 'running';
    el.className = `job ${job.status}`;
    if (active) { timer = setTimeout(tick, 600); return; }
    status.replaceWith(status = h('span.badge', { class: job.status === 'succeeded' ? 'ok' : 'danger' }, job.status));
    if (job.status !== 'succeeded') {
      el.querySelector('details').open = true;
      actions.append(h('div.callout.error', { style: { flex: 1, margin: 0 } }, job.error ?? job.status));
      if (onRetry) actions.append(h('button.btn', { onclick: onRetry }, 'Try again'));
    }
    onEnd?.(job);
  }
  tick();
  return { el, stop() { stopped = true; clearTimeout(timer); } };
}
