import { useEffect, useRef, useState } from 'react';
import { DisclaimerBanner } from '../shared/Disclaimer';
import { prefersReducedMotion } from '../shared/env';
import reliability from '../app/reliability.json';
import { chapterOpacity, scrollProgress, smoothStep } from './scroll';
import './landing.css';

const BASE = import.meta.env.BASE_URL;
const VIDEO = `${BASE}media/hero.mp4`;
const POSTER = `${BASE}media/hero-poster.jpg`;

/** Where each chapter of the story is on the scroll bar (0 to 1): fade in, hold, fade out. */
const CHAPTERS = [
  { id: 'c1', a: -0.1, b: 0.0, c: 0.2, d: 0.3 },
  { id: 'c2', a: 0.26, b: 0.34, c: 0.5, d: 0.58 },
  { id: 'c3', a: 0.6, b: 0.68, c: 0.86, d: 0.9 },
  { id: 'c4', a: 0.88, b: 0.94, c: 1.1, d: 1.2 },
] as const;

const ARTERIES = [
  { id: 'LAD', name: 'Left anterior descending', where: 'Feeds the front of the heart, the largest share of the pumping muscle.', color: 'var(--risk-high)' },
  { id: 'LCX', name: 'Left circumflex', where: 'Wraps round the side and back of the heart.', color: 'var(--risk-mid)' },
  { id: 'RCA', name: 'Right coronary artery', where: 'Feeds the right side and the underside of the heart.', color: 'var(--risk-low)' },
] as const;

const pct = (x: number) => Math.round(x * 100);
const two = (x: number) => x.toFixed(2);

export function Landing() {
  const reduced = prefersReducedMotion();
  const story = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [p, setP] = useState(0);
  const [videoOk, setVideoOk] = useState(true);

  // While the reader is looking at the first screen, fetch what the workspace needs, so it opens at once: its code, the heart model, the fonts are already in.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void import('../app/Workspace');
      for (const href of [`${BASE}models3d/heart.glb`]) {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = href;
        document.head.appendChild(link);
      }
    }, 2500);
    return () => window.clearTimeout(id);
  }, []);

  // Scroll drives the video: the target time follows the scroll bar, the shown time chases it (so a flick of the wheel does not jump).
  useEffect(() => {
    if (reduced) return;
    const el = story.current;
    const v = video.current;
    if (!el || !v) return;
    let target = 0;
    let shown = 0;
    let raf = 0;
    let last = -1;
    const read = () => {
      const r = el.getBoundingClientRect();
      target = scrollProgress(r.top, r.height, window.innerHeight);
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      shown += (target - shown) * 0.14;
      if (Math.abs(shown - last) < 0.0004) return;
      last = shown;
      setP(shown);
      if (Number.isFinite(v.duration) && v.duration > 0) {
        const t = shown * v.duration * 0.999;
        if (Math.abs(v.currentTime - t) > 0.012) v.currentTime = t;
      }
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, [reduced]);

  const o = reliability.overall;
  const ext = reliability.external;
  const weak = (['LCX', 'RCA'] as const).map((k) => ({ k, auc: o[k].auc }));

  return (
    <div className="landing" data-testid="landing">
      <DisclaimerBanner />
      <header className="l-nav">
        <a className="l-mark" href="#/">
          RiskAtlas
        </a>
        <nav aria-label="Page">
          <a href="#numbers">The numbers</a>
          <a href="#how">How it works</a>
          <a href="#safety">Safety</a>
          <a className="l-btn l-btn-ghost" href="#/app">
            Open the workspace
          </a>
        </nav>
      </header>

      {/* the story: a pinned stage whose video is scrubbed by the scroll bar */}
      <section ref={story} className={`l-story${reduced ? ' is-static' : ''}`} aria-label="What RiskAtlas does" data-testid="story">
        <div className="l-stage">
          {videoOk ? (
            <video
              ref={video}
              className="l-video"
              src={VIDEO}
              poster={POSTER}
              muted
              playsInline
              preload="auto"
              onError={() => setVideoOk(false)}
              aria-hidden="true"
            />
          ) : (
            <img className="l-video" src={POSTER} alt="" aria-hidden="true" />
          )}
          <div className="l-vignette" aria-hidden="true" />

          <div className="l-chapter c1" style={reduced ? undefined : { opacity: chapterOpacity(p, CHAPTERS[0]) }}>
            <p className="l-kicker">Coronary risk, mapped</p>
            <h1>
              See where the <em>risk</em> lives.
            </h1>
            <p className="l-lead">
              RiskAtlas turns a patient&rsquo;s clinical findings into calibrated probabilities for coronary artery disease, and draws them on a beating,
              touchable 3D heart.
            </p>
            <div className="l-cta">
              <a className="l-btn" href="#/app" data-testid="cta-open">
                Open the workspace
              </a>
              <a className="l-btn l-btn-ghost" href="#numbers">
                See how well it works
              </a>
            </div>
            {!reduced && <p className="l-scroll">Scroll to look inside</p>}
          </div>

          <div className="l-chapter c2" style={reduced ? undefined : { opacity: chapterOpacity(p, CHAPTERS[1]) }}>
            <h2>
              Fifty-two findings.
              <br />
              One picture.
            </h2>
            <p>
              Age, chest pain, blood pressure, labs, ECG and echo go in. Out come probabilities for overall disease and for each of the three arteries that feed
              the heart muscle, each with an interval and a plain-language reason.
            </p>
          </div>

          <div className="l-chapter c3" style={reduced ? undefined : { opacity: chapterOpacity(p, CHAPTERS[2]) }}>
            <h2>Three arteries. Three answers.</h2>
            <ul className="l-arteries">
              {ARTERIES.map((a) => (
                <li key={a.id} style={{ ['--c' as string]: a.color }}>
                  <b>{a.id}</b>
                  <span>
                    {a.name}. {a.where}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="l-chapter c4" style={reduced ? undefined : { opacity: chapterOpacity(p, CHAPTERS[3]) }}>
            <h2>
              Touch any part.
              <br />
              Ask why.
            </h2>
            <p>Click a structure and its panel opens: the patient&rsquo;s own values, what pushed the estimate up or down, and how far to trust it.</p>
            <a className="l-btn" href="#/app">
              Open the workspace
            </a>
          </div>

          {!reduced && <div className="l-progress" style={{ transform: `scaleX(${p.toFixed(3)})` }} aria-hidden="true" />}
        </div>
      </section>

      {/* honest numbers */}
      <section className="l-sec l-numbers" id="numbers" aria-labelledby="numbers-title">
        <div className="l-wrap">
          <p className="l-kicker">Validation</p>
          <h2 id="numbers-title">Where it is strong, and where it is not.</h2>
          <p className="l-lead">
            Four small, calibrated models trained on {reliability.patients} angiography patients and checked by repeated nested cross-validation, with the
            intervals shown. We report the weak spots as plainly as the strong ones.
          </p>
          <div className="l-auc">
            {(['CAD', 'LAD', 'LCX', 'RCA'] as const).map((k) => {
              const s = o[k];
              const strong = s.auc >= 0.8;
              return (
                <div key={k} className={`l-auc-cell${strong ? ' is-strong' : ' is-weak'}`}>
                  <span className="l-auc-id">{k}</span>
                  <span className="l-auc-num">{two(s.auc)}</span>
                  <span className="l-auc-ci">
                    ROC-AUC · 95% interval {two(s.lo)} to {two(s.hi)}
                  </span>
                  <span className="l-auc-tag">{strong ? (k === 'CAD' ? 'Strong' : 'Good') : 'Moderate: read the colour as coarse'}</span>
                  <span className="l-auc-bar" aria-hidden="true">
                    <i style={{ width: `${pct(s.auc)}%` }} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="l-notes">
            <p>
              <b>LCX and RCA are moderate</b> (ROC-AUC {weak.map((w) => two(w.auc)).join(' and ')}). For patients aged 65 and over the LCX estimate is close to
              chance, and the workspace says so on the artery&rsquo;s own panel.
            </p>
            <p>
              <b>Outside the training population it gets weaker.</b> A reduced {ext.features}-feature version scored {two(ext.internalAuc)} internally and{' '}
              {two(ext.auc)} (95% interval {two(ext.lo)} to {two(ext.hi)}) on {ext.n} patients from {ext.sites} other sites.
            </p>
            <p>
              <b>It is per artery, not per lesion.</b> It cannot say where along a vessel a narrowing sits.
            </p>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="l-sec" id="how" aria-labelledby="how-title">
        <div className="l-wrap">
          <p className="l-kicker">Method</p>
          <h2 id="how-title">From findings to the heart.</h2>
          <ol className="l-steps">
            <li>
              <b>Findings in</b>
              <span>
                52 clinical inputs: demographics, symptoms, ECG, labs, echo. Leave a field blank and the model estimates it and tells you what it estimated.
              </span>
            </li>
            <li>
              <b>Calibrated models</b>
              <span>Overall disease, then each artery given disease, so no artery ever looks riskier than the whole. No outcome label is ever an input.</span>
            </li>
            <li>
              <b>An honest reason</b>
              <span>SHAP contributions that add up exactly to the probability, plus an interval from refitted models and a check by age group.</span>
            </li>
            <li>
              <b>The map</b>
              <span>Each artery takes its risk colour, the muscle it feeds is tinted, and the heart beats at the entered pulse rate.</span>
            </li>
          </ol>
        </div>
      </section>

      {/* safety and sources */}
      <section className="l-sec l-safety" id="safety" aria-labelledby="safety-title">
        <div className="l-wrap">
          <p className="l-kicker">Safety</p>
          <h2 id="safety-title">A research prototype, not a medical device.</h2>
          <p className="l-lead">
            RiskAtlas is for decision support and education only. It does not diagnose, and it is not a substitute for formal diagnostic imaging or clinical
            judgement. The training cohort is small and from a single centre.
          </p>
          <div className="l-cta">
            <a className="l-btn" href="#/app">
              Open the workspace
            </a>
          </div>
          <p className="l-sources">
            Data: Extension of Z-Alizadeh Sani (UCI, CC BY 4.0). 3D anatomy and the X-ray thorax in the video: derived from Z-Anatomy (CC BY-SA 4.0) over
            BodyParts3D (CC BY-SA 2.1 Japan). Built for the Multimodal AI Hackathon 2026, Track A.
          </p>
        </div>
      </section>
    </div>
  );
}

export { smoothStep };
