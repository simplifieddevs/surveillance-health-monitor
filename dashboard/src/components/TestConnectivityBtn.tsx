import { useState } from 'react';
import { api } from '../api';

interface PreSaveProps {
  mode: 'presave';
  vendor: string;
  address: string;
  httpPort: string;
  username: string;
  password: string;
}

interface SavedProps {
  mode: 'saved';
  deviceId: string;
}

type Props = PreSaveProps | SavedProps;

type Result = { ok: boolean; latencyMs: number; reason?: string } | null;

export function TestConnectivityBtn(props: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function run() {
    setTesting(true);
    setResult(null);
    try {
      let res: Result;
      if (props.mode === 'presave') {
        res = await api.testConnectivity({
          vendor: props.vendor,
          address: props.address,
          vendorConfig: { httpPort: props.httpPort ? parseInt(props.httpPort, 10) : 80 },
          credentials: {
            username: props.username || undefined,
            password: props.password || undefined,
          },
        });
      } else {
        res = await api.testSavedDevice(props.deviceId);
      }
      setResult(res);
    } catch (e) {
      setResult({ ok: false, latencyMs: 0, reason: (e as Error).message });
    }
    setTesting(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={run}
        disabled={testing}
        style={{
          padding: '0.35rem 0.875rem',
          background: 'none',
          border: '1px solid var(--info)',
          borderRadius: '4px',
          color: testing ? 'var(--muted)' : 'var(--info)',
          fontSize: '12px',
          cursor: testing ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {testing ? 'Testing…' : 'Test connection'}
      </button>

      {result && (
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: result.ok ? 'var(--online)' : 'var(--offline)',
        }}>
          {result.ok
            ? `✓ Reachable (${result.latencyMs} ms)`
            : `✗ Failed${result.reason ? `: ${result.reason}` : ''}`}
        </span>
      )}
    </div>
  );
}
