import { Link } from 'react-router-dom';
import { ACTIVITY_NAV, RESEARCH_NAV } from '../components/AppShell';
import { Icon, PageHead } from '../components/ui';

export default function More() {
  return (
    <>
      <PageHead title="More" sub="Research, activity and configuration" />
      <div className="stack">
        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <h2 className="section-title">Research</h2>
          </div>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="list">
              {RESEARCH_NAV.map((item) => (
                <Link className="row row--link" to={item.to} key={item.to}>
                  <span className="avatar">
                    <Icon name={item.icon} className="ico" />
                  </span>
                  <div className="row-main">
                    <div className="row-name">{item.label}</div>
                    <div className="row-sub">
                      {item.to === '/forecast'
                        ? 'Train and evaluate the price model'
                        : item.to === '/sentiment'
                          ? 'Financial headline classification'
                          : item.to === '/backtest'
                            ? 'Strategy vs benchmark'
                            : 'Limits, controls and assessment'}
                    </div>
                  </div>
                  <span className="muted">→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Activity</h2>
          </div>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="list">
              {ACTIVITY_NAV.map((item) => (
                <Link className="row row--link" to={item.to} key={item.to}>
                  <span className="avatar">
                    <Icon name={item.icon} className="ico" />
                  </span>
                  <div className="row-main">
                    <div className="row-name">{item.label}</div>
                    <div className="row-sub">
                      {item.to === '/trades' ? 'Paper transactions and fees' : 'Preferences, models, data'}
                    </div>
                  </div>
                  <span className="muted">→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
