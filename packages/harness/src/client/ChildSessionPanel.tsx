import { useEffect, useRef, useState, type ReactElement } from 'react';
import { fetchSessionContext, type SessionContextAnswer } from './api.js';
import { appendTranscriptPage, type SessionTranscript } from './workbench-state.js';

export interface ChildSessionPanelProps {
  readonly viewerSessionId: string;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly nativeAddress?: { readonly parentSessionId: string; readonly childSessionId: string; readonly mode: 'one-shot' | 'continuable' };
  readonly checked: boolean;
  readonly identityError?: string;
  openChild(address: { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' }): void;
  retryIdentity(): void;
}

export function ChildSessionPanel(props: ChildSessionPanelProps): ReactElement {
  const { viewerSessionId, parentSessionId, childSessionId } = props;
  const identity = JSON.stringify([viewerSessionId, parentSessionId, childSessionId]);
  const [transcript, setTranscript] = useState<SessionTranscript>();
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(false);
  const current = useRef<AbortController>();

  const load = async (fromSeq?: number) => {
    current.current?.abort(); const own = new AbortController(); current.current = own;
    setLoading(true); setFailure(undefined);
    const result = await fetchSessionContext({ sessionId: viewerSessionId, targetSessionId: childSessionId, parentSessionId, ...(fromSeq === undefined ? {} : { fromSeq }) }, own.signal);
    if (own.signal.aborted) return;
    setLoading(false);
    if (!result.ok) { setFailure(result.error.message); return; }
    try { setTranscript(previous => appendTranscriptPage(childSessionId, fromSeq === undefined ? undefined : previous, result.value)); }
    catch (caught) { setFailure((caught as Error).message); }
  };

  useEffect(() => {
    setTranscript(undefined); setFailure(undefined); setLoading(false); void load();
    return () => current.current?.abort();
  }, [identity]);

  return <section className='hima-child-panel' data-hima-region='child-session'>
    <span className='hima-studio-eyebrow'>AGENT TASK</span>
    <h2>Child task evidence</h2>
    <p>Recipient: child {childSessionId}</p>
    <p className='hima-small'>Parent: {parentSessionId}</p>
    {props.checked && props.nativeAddress ? <button type='button' className='hima-button' onClick={() => { if (props.nativeAddress) props.openChild(props.nativeAddress); }}>Open child session</button>
      : props.checked ? <p className='hima-small'>Native catalog has no usable descriptor for this retained child.</p>
        : props.identityError ? <><p role='alert'>Child identity unavailable: {props.identityError}</p><button type='button' className='hima-button' data-hima-control='child-retry' onClick={props.retryIdentity}>Retry identity</button></>
          : <p>Checking the retained parent/child identity…</p>}
    <section className='hima-child-transcript'><h3>Retained native transcript</h3>
      {failure ? <p role='alert'>Retained transcript unavailable: {failure}</p> : null}
      {transcript?.events.length === 0 && !loading ? <p>No retained native events are available for this child.</p> : null}
      {transcript?.events.map(event => <article key={event.seq}><header><strong>#{event.seq}</strong><span>{event.kind}</span></header><pre>{event.text}</pre></article>)}
      {loading ? <p>Reading retained events…</p> : null}
      {transcript?.truncated ? <button type='button' className='hima-button' disabled={loading || transcript.nextSeq === undefined} onClick={() => void load(transcript.nextSeq)}>Load next retained events</button> : null}
    </section>
    <section className='hima-child-context'><h3>Current context events</h3>
      {transcript?.context.availability === 'available' ? <>
        <p className='hima-small'>Current native surface through event {transcript.context.capturedThroughSeq ?? 'unknown'}. This is a current projection, not a historical provider prompt or tool-schema snapshot.</p>
        {transcript.context.events.length === 0 ? <p>No current context events were returned.</p> : transcript.context.events.map((event, index) => <article key={`${event.seq}:${String(index)}`}><header><strong>#{event.seq}</strong><span>{event.kind}</span></header><pre>{event.text}</pre></article>)}
        {transcript.context.missing.map((missing, index) => <p className='hima-memory-warning' key={`${String(index)}:${missing}`}>Unavailable history: {missing}</p>)}
      </> : transcript?.context.availability === 'unavailable' ? <p>Current context unavailable: {transcript.context.reason}</p> : <p>Checking current context availability…</p>}
    </section>
    {transcript ? <p className='hima-small'>Native source {childSessionId} · read {transcript.asOf}</p> : null}
  </section>;
}
