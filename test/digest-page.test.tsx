import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('digest page', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync('/tmp/opencode/rig-digest-page-');
    vi.stubEnv('LANE_MARKER', 'PAGE-TEST-MARKER');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function app() {
    return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
  }

  it('renders all fields in reader order with warnings, placeholders and original offsets', async () => {
    const events = [
      { at: '2026-10-28T01:00:00+02:00', job: 'zulu', owner: 'Zoe', status: 'ok' },
      ...[1, 2, 3].map((minute) => ({
        at: `2026-10-28T01:0${minute}:00+02:00`, job: 'alpha', owner: null, status: 'retry',
      })),
      { at: '2026-10-28T01:04:00+02:00', job: 'alpha', owner: null, status: 'fail', error: '<script>bad</script>' },
      { at: '2026-10-28T01:05:00+02:00', job: 'beta', owner: null, status: 'retry' },
    ];
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\ninvalid');

    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('PAGE-TEST-MARKER');
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>beta</td>'));
    expect(html.indexOf('<td>beta</td>')).toBeLessThan(html.indexOf('<td>zulu</td>'));
    expect(html).toContain('<td>alpha</td><td>—</td><td>4</td><td><strong class="warn">3</strong></td>');
    expect(html).toContain('<strong class="warn">fail</strong>');
    expect(html).toContain('<td>beta</td><td>—</td><td>1</td><td>1</td><td>retry</td><td>—</td>');
    expect(html).toContain('<td>zulu</td><td>Zoe</td><td>1</td><td>0</td><td>ok</td><td>—</td>');
    expect(html).toContain('2026-10-28T01:01:00+02:00');
    expect(html).toContain('2026-10-28T01:04:00+02:00');
    expect(html).toContain('1 bad line skipped');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toMatch(/<script|<link|\ssrc=/);
  });

  it('renders an empty file as nothing ran', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('bad line');
  });

  it('keeps the bad-line notice when no valid events ran', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), 'bad\nalso bad\n');
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('2 bad lines skipped');
    expect(html).toContain('nothing ran');
  });

  it.each(['2026-10-29', '2026-02-30', 'not-a-night'])('returns 404 for missing or invalid night %s', async (night) => {
    expect((await app().request(`/digest/${night}`)).status).toBe(404);
  });
});
