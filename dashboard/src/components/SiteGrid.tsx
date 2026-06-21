import type { SiteWithDevices } from '../types';
import { SiteCard } from './SiteCard';

interface Props {
  sites: SiteWithDevices[];
}

export function SiteGrid({ sites }: Props) {
  if (sites.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        color: 'var(--muted)',
        fontSize: '13px',
      }}>
        No sites configured
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: '0.75rem',
      padding: '0.875rem',
      overflowY: 'auto',
      flex: 1,
      alignContent: 'start',
    }}>
      {sites.map((s) => (
        <SiteCard key={s.site.id} data={s} />
      ))}
    </div>
  );
}
