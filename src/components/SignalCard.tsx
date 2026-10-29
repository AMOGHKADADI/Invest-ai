import { Link } from 'react-router-dom';
import type { Signal } from '../lib/types';
import { formatDateTime, inr, pct, relativeTime } from '../lib/format';
import { Avatar, SideBadge } from './ui';

/** Buy / Sell / Hold card with the evidence the signal engine actually used. */
export function SignalCard({
  signal,
  changePct,
  showLink = true,
  footer,
}: {
  signal: Signal;
  changePct?: number | null;
  showLink?: boolean;
  footer?: React.ReactNode;
}) {
  const strength = Math.round(signal.confidence * 100);
  return (
    <article className="signal-card">
      <div className="signal-top">
        <div className="inline">
          <Avatar symbol={signal.symbol} />
          <div>
            <div className="row-name">{signal.symbol}</div>
            <div className="row-sub">
              {relativeTime(signal.at)} · {formatDateTime(signal.at)}
            </div>
          </div>
        </div>
        <SideBadge side={signal.side} />
      </div>

      <div className="signal-mid">
        <span className="tile-value">{inr(signal.price, 2)}</span>
        {typeof changePct === 'number' ? (
          <span className={`row-change ${changePct >= 0 ? 'pos' : 'neg'}`}>{pct(changePct)}</span>
        ) : null}
        <span className="tag" title="Heuristic strength of the computed score — not a calibrated probability.">
          Strength {strength}%
        </span>
        <span className="tag">Score {signal.score >= 0 ? '+' : ''}{signal.score.toFixed(2)}</span>
      </div>

      <ul className="reasons">
        {signal.reasons.map((reason, i) => (
          <li key={i} className={reason.tone === 'positive' ? 'pos' : reason.tone === 'negative' ? 'neg' : ''}>
            {reason.text}
          </li>
        ))}
      </ul>

      {footer}

      {showLink ? (
        <div className="inline">
          <Link className="btn btn--outline-signal btn--sm" to={`/markets/${signal.symbol}`}>
            View chart →
          </Link>
        </div>
      ) : null}
    </article>
  );
}
