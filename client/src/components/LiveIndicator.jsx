import { useLiveStatus } from '../hooks/useLiveEvents';

const states = {
  live: { label: 'Live', detail: 'Seats update in real time', dot: 'bg-success-500', pulse: true },
  connecting: { label: 'Connecting', detail: 'Reconnecting to live updates', dot: 'bg-warning-500', pulse: false },
  offline: { label: 'Offline', detail: 'Live updates paused; retrying shortly', dot: 'bg-ink-400', pulse: false },
};

/** Small status pill showing whether the catalogue is receiving live updates. */
export function LiveIndicator() {
  const s = states[useLiveStatus()];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-600" title={s.detail}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {s.pulse && <span className={`live-pulse absolute inline-flex h-full w-full rounded-full ${s.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`} />
      </span>
      <span>{s.label}</span>
      <span className="sr-only">: {s.detail}</span>
    </span>
  );
}
