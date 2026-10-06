// The conversation card of one `hima_insight_analysis` call (ADR-0021). A proposal is shown for the
// person to answer in the conversation, never with a confirm button; a started or finished analysis
// opens its own page, which the desktop App shows in a window of its own.
import type { ReactElement } from 'react';
import type { ToolBlock } from './HimaRunCard.js';
import { readInsightAnalysisCard } from './insight-analysis-card.js';
import { HIMA_STYLE } from './workbench-style.js';

function OpenPage({ page }: { readonly page: string }): ReactElement {
  return <button type='button' className='hima-button hima-analysis-card-open' data-hima-control='open-analysis-page'
    onClick={() => { window.open(page, '_blank', 'noopener'); }}>Open analysis page</button>;
}

export function InsightAnalysisCard({ block }: { readonly block: ToolBlock }): ReactElement {
  const card = readInsightAnalysisCard(block);
  const body = (() => {
    switch (card.kind) {
      case 'pending': return <p className='hima-muted'>Working on the library analysis…</p>;
      case 'text': return <pre className={card.error ? 'hima-analysis-card-error' : 'hima-receipt-body'}>{card.text}</pre>;
      case 'proposal': return <>
        <span className='hima-analysis-card-eyebrow'>Library analysis · proposal</span>
        <p className='hima-analysis-card-question'>{card.question}</p>
        <dl className='hima-analysis-card-facts'>
          <dt>Libraries</dt><dd>{card.sources.length === 0 ? 'Found by the resident agent on the Site' : <ul>{card.sources.map(source => <li key={source}><code>{source}</code></li>)}</ul>}</dd>
          {card.buildsOn.length === 0 ? null : <><dt>Builds on</dt><dd>{card.buildsOn.map(ref => <code key={ref}>{ref}</code>)}</dd></>}
          {card.pack === undefined ? null : <><dt>Pack</dt><dd>{card.pack}</dd></>}
          {card.site === undefined ? null : <><dt>Site</dt><dd>{card.site}</dd></>}
          {card.timeBoxMinutes === undefined ? null : <><dt>Time box</dt><dd>{card.timeBoxMinutes} min</dd></>}
        </dl>
        {card.ready ? <p className='hima-analysis-card-next'>Nothing runs yet. Reply in the conversation to start it.</p>
          : <div className='hima-analysis-card-unready'><p>Not ready to start:</p><ul>{card.unknowns.map(item => <li key={item}>{item}</li>)}</ul></div>}
      </>;
      case 'started': return <>
        <span className='hima-analysis-card-eyebrow'>Library analysis · started</span>
        <p>The resident agent is writing and running the analysis. Its page fills in as it works.</p>
        <p className='hima-small'>Run <code>{card.runId}</code></p>
        <OpenPage page={card.page} />
      </>;
      case 'result': return <>
        <span className='hima-analysis-card-eyebrow'>Library analysis</span>
        <p className='hima-analysis-card-state' data-state={card.state}>{card.said}</p>
        {card.question === undefined ? null : <p className='hima-analysis-card-question'>{card.question}</p>}
        {card.summary === undefined ? null : <p className='hima-analysis-card-summary'>{card.summary}</p>}
        <OpenPage page={card.page} />
      </>;
      case 'list': return <>
        <span className='hima-analysis-card-eyebrow'>Library analyses</span>
        {card.rows.length === 0 ? <p className='hima-muted'>No analyses in this project yet.</p>
          : <ul className='hima-analysis-card-list'>{card.rows.map(row => <li key={row.runId}>
              <span>{row.question ?? row.runId}</span><span className='hima-small'>{row.said}</span>
              <button type='button' className='hima-button' data-hima-control='open-analysis-page' onClick={() => { window.open(row.page, '_blank', 'noopener'); }}>Open</button>
            </li>)}</ul>}
      </>;
    }
  })();
  return <div className='hima-run-card hima-analysis-card hima-root' data-hima-region='insight-analysis' data-hima-state-card={card.kind}>
    <style>{HIMA_STYLE}</style>
    {body}
  </div>;
}
