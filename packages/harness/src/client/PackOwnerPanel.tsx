// The Pack owner panel (#41 task 7): moved out of `HimaWorkbench.tsx` verbatim in behaviour, restyled
// with classes. Same-session owner reviews actual local file hashes before applying a transfer —
// install a Pack from a folder, share method or selected materials, migrate a Pack with its assets,
// or install a tested method upgrade. Every write is a two-step review-then-confirm the person drives
// themselves; nothing here is reachable by HimaGuide.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { reviewPackTransfer } from './api.js';
import { Glyph } from './glyphs.js';

export interface PackOwnerPanelProps {
  readonly sessionId: string;
  readonly initialPack: string;
  readonly initialLocation?: string;
  /** The native folder picker (#41 task 8), when the shell's own `uiWorkspace` service is present.
   *  Absent, the location fields stay the plain text inputs they always were — `owner-location`
   *  keeps taking a typed or filled path either way, which is what the pack-owner desktop test does. */
  readonly pickFolder?: () => Promise<string | null>;
}

export function PackOwnerPanel({ sessionId, initialPack, initialLocation, pickFolder }: PackOwnerPanelProps): ReactElement {
  const [pack, setPack] = useState(initialPack);
  const [mode, setMode] = useState<'install' | 'share' | 'migrate' | 'upgrade'>(initialPack ? 'share' : 'install');
  const [location, setLocation] = useState(initialLocation ?? '');
  const [assets, setAssets] = useState('');
  const [review, setReview] = useState<import('../release.js').PackTransferReview>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fromSource = mode === 'install' || mode === 'upgrade';
  const pending = useRef(false);
  const controller = useRef<AbortController | undefined>();
  useEffect(() => () => controller.current?.abort(), []);
  const invalidate = () => { setReview(undefined); setMessage(''); };
  const submit = async (confirm: boolean) => {
    if (pending.current || (confirm && !review)) return;
    pending.current = true; setBusy(true); setMessage('');
    const own = new AbortController(); controller.current = own;
    const result = await reviewPackTransfer({ sessionId, pack, mode, to: fromSource ? '' : location,
      ...(fromSource ? { source: location } : {}),
      ...(mode === 'share' ? { assets: assets.split('\n').map(line => line.trim()).filter(Boolean) } : {}),
      ...(confirm ? { reviewSha256: review!.reviewSha256 } : {}) }, own.signal);
    if (own.signal.aborted) return;
    pending.current = false; setBusy(false);
    if (!result.ok) { setReview(undefined); setMessage(result.error.message); return; }
    setReview(result.value);
    setMessage(confirm ? 'Confirmed files verified and written. No public upload was performed.' : 'Review the exact files and destination before confirming.');
    if (confirm) setReview(undefined);
  };
  return <section className='hima-detail' data-hima-region='pack-owner'>
    <h3>Pack & knowledge assets</h3>
    <p className='hima-small'>Install a transparent Pack folder, then inspect or move its method and local research assets.</p>
    <fieldset disabled={busy} className='hima-owner-fieldset'>
      <div className='hima-fields'>
        <label>Installed Pack<input data-hima-control='owner-pack' value={pack} onChange={event => { invalidate(); setPack(event.target.value); }} /></label>
        <label>Action<select data-hima-control='owner-mode' value={mode} onChange={event => { invalidate(); setMode(event.target.value as typeof mode); }}>
          <option value='install'>Install Pack from folder</option><option value='share'>Share method / selected materials</option><option value='migrate'>Migrate my Pack with all assets</option><option value='upgrade'>Install tested method upgrade</option>
        </select></label>
        <label>{fromSource ? (mode === 'install' ? 'Pack source folder' : 'Tested release source folder') : 'New destination Pack folder'}
          <span className='hima-owner-location-row'>
            <input data-hima-control='owner-location' value={location} onChange={event => { invalidate(); setLocation(event.target.value); }} />
            {pickFolder ? <button type='button' className='hima-icon-button' data-hima-control='owner-location-pick' aria-label='Choose a folder'
              onClick={() => { void pickFolder().then((picked) => { if (picked !== null) { invalidate(); setLocation(picked); } }).catch(() => {}); }}><Glyph name='locate' /></button> : null}
          </span>
        </label>
      </div>
      {mode === 'share' ? <label className='hima-owner-assets-label'>Optional material paths, one per line<textarea className='hima-run-card-owner-textarea' data-hima-control='owner-assets' value={assets} placeholder='Empty shares only the method. Select paths inside run-assets/ to include research.' onChange={event => { invalidate(); setAssets(event.target.value); }} /></label>
        : <p className='hima-small'>{mode === 'install' ? 'Review shows every method and knowledge file before this fixed Pack is installed. Author status is displayed and does not change execution.' : mode === 'migrate' ? 'Migration includes your private run-assets and historical methods. Use only your own destination.' : 'The current method remains unchanged until you confirm a tested release. Old methods and run-assets are retained.'}</p>}
      <button className='hima-button hima-owner-review-button' data-hima-control='owner-review' disabled={!pack || !location} onClick={() => { void submit(false); }}>Review files</button>
      {review ? <div data-hima-region='pack-review'>
        <p className='hima-wrap'>Destination: <code>{review.to}</code></p>
        <p className='hima-small'>{review.files.length} files · {review.changes.length} changes · review <code title={review.reviewSha256}>{review.reviewSha256.slice(0, 12)}</code></p>
        <div className='hima-run-card-material-panel'><table><thead><tr><th className='hima-owner-file-column'>File</th><th className='hima-owner-bytes-column'>Bytes</th><th>SHA-256</th></tr></thead><tbody>{review.files.map(file => <tr key={file.path}><td className='hima-owner-file-cell'>{file.path}</td><td>{file.bytes}</td><td><code title={file.sha256}>{file.sha256.slice(0, 12)}</code></td></tr>)}</tbody></table></div>
        {/* C18: the raw JSON dump added nothing the table above does not already state in words —
            every file, its bytes and its hash — so it is removed rather than kept as a second,
            unreadable copy of the same review. */}
        <button className='hima-button hima-primary' data-hima-control='owner-confirm' onClick={() => { void submit(true); }}>Confirm these exact files</button>
      </div> : null}
    </fieldset>
    {message ? <p role='status' data-hima-region='pack-owner-message'>{message}</p> : null}
  </section>;
}
