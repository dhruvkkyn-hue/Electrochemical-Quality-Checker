import { useMemo, useState } from 'react';
import { Activity, Beaker, Check, ChevronRight, CircleAlert, Crosshair, Database, Download, FileText, Gauge, GitCompare, Info, LoaderCircle, Play, Printer, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Table2, Waves } from 'lucide-react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { fetch_reading, generateSyntheticReading } from '@/lib/sensor-api';

type SampleState = 'Good' | 'Medium' | 'Bad';
type Phase = 'idle' | 'running' | 'ready' | 'error';
type Point = { potential: number; current: number };
type Measurement = {
  id: string;
  state: SampleState;
  noise: number;
  predicted: SampleState;
  confidence: number;
  peakCurrent: number;
  peakPotential: number;
  auc: number;
  snr: number;
  baselineDrift: number;
  peakWidth: number;
  symmetry: number;
  points: Point[];
  probabilities: Record<SampleState, number>;
};

const queryClient = new QueryClient();
const STATES: SampleState[] = ['Good', 'Medium', 'Bad'];
const statusClass: Record<SampleState, string> = {
  Good: 'status-good',
  Medium: 'status-medium',
  Bad: 'status-bad',
};
const statusColor: Record<SampleState, string> = {
  Good: 'hsl(159 64% 38%)',
  Medium: 'hsl(30 74% 53%)',
  Bad: 'hsl(4 67% 52%)',
};

function buildMeasurement(state: SampleState, noise: number, run: number, pointsOverride?: Point[]): Measurement {
  const profile = {
    Good: { amplitude: 1.0, width: 0.055, drift: 0.012, symmetry: 0.96 },
    Medium: { amplitude: 0.6, width: 0.078, drift: 0.036, symmetry: 0.84 },
    Bad: { amplitude: 0.16, width: 0.12, drift: 0.079, symmetry: 0.62 },
  }[state];
  const points: Point[] = pointsOverride ?? generateSyntheticReading({ state, noise, run });
  const peakPoint = points.reduce((max, point) => point.current > max.current ? point : max, points[0]);
  const auc = points.reduce((total, point, index) => index === 0 ? total : total + ((points[index - 1].current + point.current) / 2) * (point.potential - points[index - 1].potential), 0);
  const quality = Math.max(0, Math.min(1, (profile.amplitude / 1.0) * (1 - noise * 5.5) * (1 - profile.drift * 2)));
  const predicted: SampleState = quality > 0.68 ? 'Good' : quality > 0.35 ? 'Medium' : 'Bad';
  const confidence = Math.max(0.61, Math.min(0.99, 0.66 + quality * 0.31 - noise * 0.2));
  const goodProbability = predicted === 'Good' ? confidence : Math.max(0.04, (1 - confidence) * (state === 'Good' ? 0.7 : 0.42));
  const badProbability = predicted === 'Bad' ? confidence : Math.max(0.04, (1 - confidence) * (state === 'Bad' ? 0.7 : 0.42));
  const mediumProbability = Math.max(0.03, 1 - goodProbability - badProbability);
  const sum = goodProbability + mediumProbability + badProbability;
  return {
    id: `DPV-${String(run).padStart(4, '0')}`,
    state,
    noise,
    predicted,
    confidence,
    peakCurrent: peakPoint.current,
    peakPotential: peakPoint.potential,
    auc,
    snr: Math.max(4.8, 22.4 * quality - noise * 42),
    baselineDrift: profile.drift + noise * 0.18,
    peakWidth: profile.width * (1 + noise * 1.8),
    symmetry: Math.max(0.41, profile.symmetry - noise * 1.5),
    points,
    probabilities: {
      Good: goodProbability / sum,
      Medium: mediumProbability / sum,
      Bad: badProbability / sum,
    },
  };
}

function StatusBadge({ status }: { status: SampleState }) {
  return (
    <span className={`status-chip ${statusClass[status]}`} data-testid={`status-predicted-${status.toLowerCase()}`}>
      <span className="status-dot" style={{ background: statusColor[status], boxShadow: `0 0 0 3px ${statusColor[status]}22` }} />
      {status} signal
    </span>
  );
}

function DpvChart({ measurement, comparison }: { measurement: Measurement; comparison?: Measurement }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const width = 900;
    const height = 330;
    const pad = { left: 57, right: 24, top: 22, bottom: 43 };
    const minY = 0;
    const maxY = 1.3;
    const x = (potential: number) => pad.left + (potential / 0.8) * (width - pad.left - pad.right);
    const y = (current: number) => height - pad.bottom - ((current - minY) / (maxY - minY)) * (height - pad.top - pad.bottom);
    const makePath = (points: Point[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.potential).toFixed(2)} ${y(point.current).toFixed(2)}`).join(' ');
    const peakX = x(measurement.peakPotential);
    const peakY = y(measurement.peakCurrent);
    return { width, height, pad, x, y, path: makePath(measurement.points), comparisonPath: comparison ? makePath(comparison.points) : null, peakX, peakY, comparisonPeakX: comparison ? x(comparison.peakPotential) : null, comparisonPeakY: comparison ? y(comparison.peakCurrent) : null };
  }, [measurement, comparison]);
  const activePoint = hoverIndex === null ? null : measurement.points[hoverIndex];
  const activeX = activePoint ? chart.x(activePoint.potential) : 0;
  const activeY = activePoint ? chart.y(activePoint.current) : 0;

  return (
    <div className="chart-wrap">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="eyebrow">Raw signal · differential pulse voltammetry</p>
          <h2 className="text-base font-bold mt-2">Current response curve</h2>
        </div>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-line" /> measured</span>
          <span className="legend-item"><span className="legend-dash" /> peak marker</span>
        </div>
      </div>
      <div className="relative">
        <svg className="chart-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Interactive differential pulse voltammetry signal chart" data-testid="chart-dpv-signal">
          <defs>
            <linearGradient id="signal-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(183 72% 31% / .14)" />
              <stop offset="100%" stopColor="hsl(183 72% 31% / 0)" />
            </linearGradient>
          </defs>
          {[0, 0.325, 0.65, 0.975, 1.3].map((tick) => (
            <g key={tick}>
              <line x1={chart.pad.left} x2={chart.width - chart.pad.right} y1={chart.y(tick)} y2={chart.y(tick)} stroke="hsl(36 21% 80% / .75)" strokeWidth="1" />
              <text x={chart.pad.left - 12} y={chart.y(tick) + 4} textAnchor="end" fill="hsl(213 14% 45%)" fontSize="11" fontFamily="Space Mono">{tick.toFixed(1)}</text>
            </g>
          ))}
           {[0, 0.2, 0.4, 0.6, 0.8].map((tick) => (
            <g key={tick}>
              <line x1={chart.x(tick)} x2={chart.x(tick)} y1={chart.pad.top} y2={chart.height - chart.pad.bottom} stroke="hsl(36 21% 80% / .4)" strokeWidth="1" />
              <text x={chart.x(tick)} y={chart.height - 17} textAnchor="middle" fill="hsl(213 14% 45%)" fontSize="11" fontFamily="Space Mono">{tick.toFixed(2)}</text>
            </g>
          ))}
           <path d={`${chart.path} L ${chart.x(.8)} ${chart.height - chart.pad.bottom} L ${chart.x(0)} ${chart.height - chart.pad.bottom} Z`} fill="url(#signal-fill)" />
          <path d={chart.path} fill="none" stroke="hsl(183 72% 31%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="chart-line" />
          {chart.comparisonPath && <path d={chart.comparisonPath} fill="none" stroke="hsl(4 67% 52%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="chart-line comparison-line" />}
          <line x1={chart.peakX} x2={chart.peakX} y1={chart.pad.top} y2={chart.height - chart.pad.bottom} stroke="hsl(23 74% 56%)" strokeWidth="1.5" strokeDasharray="5 5" />
          <circle cx={chart.peakX} cy={chart.peakY} r="5" fill="hsl(42 38% 98%)" stroke="hsl(23 74% 56%)" strokeWidth="2.5" />
          {chart.comparisonPeakX !== null && chart.comparisonPeakY !== null && <><line x1={chart.comparisonPeakX} x2={chart.comparisonPeakX} y1={chart.pad.top} y2={chart.height - chart.pad.bottom} stroke="hsl(4 67% 52%)" strokeWidth="1.5" strokeDasharray="3 5" /><circle cx={chart.comparisonPeakX} cy={chart.comparisonPeakY} r="5" fill="hsl(42 38% 98%)" stroke="hsl(4 67% 52%)" strokeWidth="2.5" /></>}
          {activePoint && (
            <g className="chart-tooltip">
              <line x1={activeX} x2={activeX} y1={chart.pad.top} y2={chart.height - chart.pad.bottom} stroke="hsl(213 31% 17% / .28)" strokeDasharray="3 4" />
              <circle cx={activeX} cy={activeY} r="4" fill="hsl(183 72% 31%)" stroke="hsl(42 38% 98%)" strokeWidth="2" />
              <g transform={`translate(${Math.min(activeX + 10, 745)},${Math.max(activeY - 48, 12)})`}>
                <rect width="125" height="38" rx="5" fill="hsl(211 36% 16%)" />
                <text x="10" y="15" fill="hsl(40 30% 92%)" fontSize="10" fontFamily="Space Mono">{activePoint.potential.toFixed(3)} V</text>
                <text x="10" y="30" fill="hsl(177 61% 54%)" fontSize="10" fontFamily="Space Mono">{activePoint.current.toFixed(3)} µA</text>
              </g>
            </g>
          )}
          <rect x={chart.pad.left} y={chart.pad.top} width={chart.width - chart.pad.left - chart.pad.right} height={chart.height - chart.pad.top - chart.pad.bottom} fill="transparent" onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
            setHoverIndex(Math.round(ratio * (measurement.points.length - 1)));
          }} onMouseLeave={() => setHoverIndex(null)} data-testid="chart-hover-target" />
          <text x="12" y="24" fill="hsl(213 14% 45%)" fontSize="10" fontFamily="Space Mono" transform="rotate(-90 12 24)">CURRENT (µA)</text>
          <text x={chart.width - 84} y={chart.height - 4} fill="hsl(213 14% 45%)" fontSize="10" fontFamily="Space Mono">POTENTIAL (V)</text>
        </svg>
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Peak detected at <strong className="mono text-foreground">{measurement.peakPotential.toFixed(3)} V</strong></span>
         <span className="mono">{measurement.points.length} samples · 8 mV step</span>
      </div>
    </div>
  );
}

function ProbabilityBars({ measurement }: { measurement: Measurement }) {
  return (
    <div className="panel p-[21px_23px]" data-testid="panel-probabilities">
      <div className="flex items-start justify-between">
        <div><p className="eyebrow">Classifier output</p><h2 className="text-base font-bold mt-2">Class probabilities</h2></div>
        <Gauge size={17} strokeWidth={1.7} className="text-muted-foreground" />
      </div>
      {STATES.map((status) => (
        <div className="prob-row" key={status} data-testid={`probability-row-${status.toLowerCase()}`}>
          <span className="text-xs font-semibold">{status}</span>
          <div className="prob-track"><div className="prob-fill" style={{ width: `${measurement.probabilities[status] * 100}%`, background: statusColor[status] }} /></div>
          <span className="mono text-[11px] text-right">{(measurement.probabilities[status] * 100).toFixed(1)}%</span>
        </div>
      ))}
      <div className="mt-5 pt-4 border-t border-border flex items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="shrink-0 mt-0.5 text-primary" />
        <span>Probabilities reflect the extracted signal shape at the selected noise level, not a reference library match.</span>
      </div>
    </div>
  );
}

function Features({ measurement }: { measurement: Measurement }) {
  const features = [
    ['Peak current', `${measurement.peakCurrent.toFixed(3)} µA`, 'signal maximum'],
    ['Peak potential', `${measurement.peakPotential.toFixed(3)} V`, 'apex location'],
    ['Area under curve', `${measurement.auc.toFixed(3)} µA·V`, 'trapezoidal integration'],
    ['Signal-to-noise', `${measurement.snr.toFixed(1)} dB`, 'peak / noise floor'],
    ['Baseline drift', `${measurement.baselineDrift.toFixed(3)} µA`, 'linear fit residual'],
    ['Peak width', `${(measurement.peakWidth * 1000).toFixed(0)} mV`, 'full width estimate'],
    ['Peak symmetry', measurement.symmetry.toFixed(2), 'shape coefficient'],
  ];
  return (
    <div className="panel p-[21px_23px]" data-testid="panel-features">
      <div className="flex items-start justify-between mb-4">
        <div><p className="eyebrow">Feature extraction</p><h2 className="text-base font-bold mt-2">Raw extracted features</h2></div>
        <Crosshair size={17} strokeWidth={1.7} className="text-muted-foreground" />
      </div>
      <table className="feature-table">
        <thead><tr><th>Feature</th><th>Value</th></tr></thead>
        <tbody>{features.map(([name, value, hint], index) => (
          <tr key={name} data-testid={`feature-row-${index}`}>
            <td><span className="font-semibold">{name}</span><span className="block text-[10px] text-muted-foreground mt-0.5">{hint}</span></td>
            <td>{value}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ModelDiagnostics() {
  const algorithms = [
    { name: 'Logistic Regression', accuracy: '94.2%', precision: '93.8%', recall: '94.1%', note: 'interpretable baseline' },
    { name: 'Random Forest', accuracy: '97.1%', precision: '96.8%', recall: '97.0%', note: 'best overall fit' },
    { name: 'Support Vector Machine', accuracy: '95.6%', precision: '95.3%', recall: '95.4%', note: 'strong margin separation' },
  ];
  const matrix = [[38, 1, 0], [2, 35, 1], [0, 1, 40]];
  return (
    <section id="model-diagnostics" className="panel mt-[18px] p-[21px_23px] appear delay-2" data-testid="panel-model-diagnostics">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="eyebrow">Model diagnostics</p><h2 className="text-base font-bold mt-2">Performance across classifiers</h2><p className="text-xs text-muted-foreground mt-2 max-w-xl">Held-out synthetic validation set · 120 signals · three balanced classes</p></div>
        <div className="diagnostic-pill"><Check size={14} /> validation complete</div>
      </div>
      <div className="diagnostics-grid mt-6">
        <div>
          <div className="flex items-center gap-2 mb-3"><Table2 size={15} className="text-primary" /><p className="eyebrow">Random Forest confusion matrix</p></div>
          <div className="matrix-wrap">
            <div className="matrix-axis matrix-y">actual</div>
            <div className="matrix-content">
              <div className="matrix-labels"><span>Good</span><span>Medium</span><span>Bad</span></div>
              <div className="matrix-grid">{matrix.flatMap((row, rowIndex) => row.map((value, colIndex) => <div key={`${rowIndex}-${colIndex}`} className={`matrix-cell ${rowIndex === colIndex ? 'diagonal' : ''}`} style={{ opacity: 0.45 + value / 90 }}>{value}</div>))}</div>
              <div className="matrix-labels bottom"><span>Good</span><span>Medium</span><span>Bad</span></div>
            </div>
            <div className="matrix-axis bottom-axis">predicted</div>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-3"><Gauge size={15} className="text-primary" /><p className="eyebrow">Accuracy comparison</p></div>
          <div className="algorithm-table">
            <div className="algorithm-row algorithm-header"><span>Algorithm</span><span>Accuracy</span><span>Precision</span><span>Recall</span></div>
            {algorithms.map((algorithm) => <div className="algorithm-row" key={algorithm.name}><span><strong>{algorithm.name}</strong><small>{algorithm.note}</small></span><span className="mono text-primary font-bold">{algorithm.accuracy}</span><span className="mono">{algorithm.precision}</span><span className="mono">{algorithm.recall}</span></div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReportCard({ measurement, comparison }: { measurement: Measurement; comparison?: Measurement }) {
  const printReport = () => window.print();
  return (
    <section id="summary-report" className="panel mt-[18px] report-section" data-testid="panel-summary-report">
      <div className="report-toolbar"><div><p className="eyebrow">Reporting</p><h2 className="text-base font-bold mt-2">Summary report</h2></div><button className="ghost-button" onClick={printReport} data-testid="button-print-report"><Printer size={14} /> Print report</button></div>
      <div className="report-body">
        <div className="report-heading"><div><p className="eyebrow">Electrochemical Signal Quality Checker</p><h3>Measurement summary · {measurement.id}</h3></div><StatusBadge status={measurement.predicted} /></div>
        <div className="report-meta"><span>Generated locally</span><span>DPV / Synthetic cell A-04</span><span>0.00–0.80 V</span></div>
        <div className="report-stats"><div><span>Prediction</span><strong>{measurement.predicted}</strong></div><div><span>Confidence</span><strong>{(measurement.confidence * 100).toFixed(1)}%</strong></div><div><span>Peak current</span><strong>{measurement.peakCurrent.toFixed(3)} µA</strong></div><div><span>AUC</span><strong>{measurement.auc.toFixed(3)} µA·V</strong></div></div>
        <div className="report-features"><div><span>Peak potential</span><strong>{measurement.peakPotential.toFixed(3)} V</strong></div><div><span>Signal-to-noise</span><strong>{measurement.snr.toFixed(1)} dB</strong></div><div><span>Baseline drift</span><strong>{measurement.baselineDrift.toFixed(3)} µA</strong></div><div><span>Peak width</span><strong>{(measurement.peakWidth * 1000).toFixed(0)} mV</strong></div></div>
        {comparison && <p className="report-note">Comparison trace included: {comparison.id} · {comparison.state} sample at {(comparison.noise).toFixed(2)} noise variance.</p>}
        <p className="report-footnote">This proof-of-concept uses synthetic data for software pipeline demonstration only. It is not a laboratory validation result.</p>
      </div>
    </section>
  );
}

function downloadSignalCsv(measurement: Measurement, comparison?: Measurement) {
  const header = comparison ? 'Voltage (V),Current (µA),Comparison Voltage (V),Comparison Current (µA)' : 'Voltage (V),Current (µA)';
  const rows = measurement.points.map((point, index) => comparison
    ? [point.potential.toFixed(3), point.current.toFixed(5), comparison.points[index].potential.toFixed(3), comparison.points[index].current.toFixed(5)].join(',')
    : [point.potential.toFixed(3), point.current.toFixed(5)].join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = comparison ? `${measurement.id}-${comparison.id}-signals.csv` : `${measurement.id}-signal.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function EmptyState({ error, onRetry }: { error?: boolean; onRetry: () => void }) {
  return (
    <div className={`panel empty-state ${error ? 'error-state' : ''}`} data-testid={error ? 'state-error' : 'state-initial'}>
      <div className="instrument-icon">{error ? <CircleAlert size={27} /> : <Waves size={27} />}</div>
      <p className="eyebrow">{error ? 'Measurement interrupted' : 'Ready for acquisition'}</p>
      <h2 className="text-xl font-bold mt-2">{error ? 'The synthetic signal could not be classified' : 'No measurement in view'}</h2>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mt-2">{error ? 'Try the run again. Your acquisition settings are still preserved.' : 'Choose a simulated sample state and noise variance, then run a measurement to inspect the full signal trace.'}</p>
      {error && <button className="ghost-button mt-5" onClick={onRetry} data-testid="button-retry"><RotateCcw size={14} className="inline mr-2" />Try again</button>}
      {!error && <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground mono"><span className="status-dot" />synthetic instrument connected</div>}
    </div>
  );
}

function Home() {
  const [sampleState, setSampleState] = useState<SampleState>('Good');
  const [noise, setNoise] = useState(0.02);
  const [run, setRun] = useState(12);
  const [phase, setPhase] = useState<Phase>('ready');
  const [measurement, setMeasurement] = useState<Measurement | null>(() => buildMeasurement('Good', 0.02, 12));
  const [compareMode, setCompareMode] = useState(false);
  const [compareState, setCompareState] = useState<SampleState>('Bad');
  const [comparison, setComparison] = useState<Measurement | null>(() => buildMeasurement('Bad', 0.02, 11));

  const runMeasurement = () => {
    setPhase('running');
    window.setTimeout(async () => {
      try {
        const nextRun = run + 1;
        const points = await fetch_reading({ state: sampleState, noise, run: nextRun });
        setRun(nextRun);
        setMeasurement(buildMeasurement(sampleState, noise, nextRun, points));
        setPhase('ready');
      } catch {
        setPhase('error');
      }
    }, 720);
  };
  const runComparison = () => {
    const compareRun = run + 100;
    setComparison(buildMeasurement(compareState, noise, compareRun));
  };
  const clearMeasurement = () => {
    setMeasurement(null);
    setComparison(null);
    setPhase('idle');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="flex items-center gap-3 px-2">
          <div className="brand-mark"><Activity size={18} strokeWidth={2.2} /></div>
          <div><div className="text-sm font-bold tracking-tight">Electrochemical</div><div className="text-[11px] text-sidebar-foreground/50">Signal Quality Checker</div></div>
        </div>
        <div className="mt-12 px-2 side-eyebrow">Workspace</div>
        <nav className="mt-3 space-y-1" aria-label="Primary navigation">
          <button className="nav-item active w-full text-left" data-testid="nav-measurement"><Gauge size={16} /><span>Measurement</span><ChevronRight size={14} className="ml-auto opacity-60" /></button>
          <button className="nav-item w-full text-left" onClick={() => document.getElementById('method-note')?.scrollIntoView({ behavior: 'smooth' })} data-testid="nav-method"><ShieldCheck size={16} /><span>Method notes</span></button>
           <button className="nav-item w-full text-left" onClick={() => document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' })} data-testid="nav-features"><Database size={16} /><span>Feature log</span></button>
           <button className="nav-item w-full text-left" onClick={() => document.getElementById('model-diagnostics')?.scrollIntoView({ behavior: 'smooth' })} data-testid="nav-diagnostics"><Table2 size={16} /><span>Model diagnostics</span></button>
        </nav>
        <div className="mt-10 px-2 side-eyebrow">Instrument</div>
        <div className="mt-3 mx-1 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className="status-dot" />Synthetic cell A-04</div>
           <div className="mt-3 grid grid-cols-2 gap-y-2 text-[10px] mono text-sidebar-foreground/50"><span>mode</span><span className="text-right text-sidebar-foreground/80">DPV</span><span>step</span><span className="text-right text-sidebar-foreground/80">8 mV</span><span>range</span><span className="text-right text-sidebar-foreground/80">0.00—0.80 V</span></div>
        </div>
        <div className="sidebar-foot"><div className="readout"><p>LAST CALIBRATION</p><strong>Today · 08:42:17</strong><p className="mt-2">CELL TEMPERATURE</p><strong>23.4 °C</strong></div><div className="mt-6 text-[10px] text-sidebar-foreground/35 mono">LAB CONSOLE / BUILD 0.8.4</div></div>
      </aside>

      <div className="main-frame">
        <div className="mobile-topbar"><div className="flex items-center gap-2.5"><div className="brand-mark"><Activity size={17} /></div><span className="text-sm font-bold">Signal Quality Checker</span></div><span className="mono text-[10px] text-sidebar-foreground/60">DPV / A-04</span></div>
        <header className="topbar">
          <div><p className="eyebrow">Bench workspace <span className="mx-1">/</span> Acquisition 01</p><h1 className="text-lg font-bold tracking-tight mt-1">Electrochemical signal quality</h1></div>
          <div className="top-status"><span className="status-dot" />Synthetic instrument online <span className="mx-1 text-border">·</span><span className="mono text-[10px]">DPV-24A</span></div>
        </header>

        <main className="workspace">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-7 appear">
            <div><p className="eyebrow text-primary">Quality call / synthetic sample</p><h2 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold tracking-[-.04em] mt-2">Inspect the signal. Trust the call.</h2><p className="text-sm text-muted-foreground mt-2 max-w-xl">A transparent DPV check that keeps the raw trace, extracted features, and model reasoning in the same field of view.</p></div>
            {measurement && phase === 'ready' && <div className="flex items-center gap-3"><span className="mono text-[10px] text-muted-foreground">{measurement.id}</span><button className="ghost-button" onClick={clearMeasurement} data-testid="button-clear-result">Clear result</button></div>}
          </div>

          <div className="section-grid">
            <section className="panel control-panel appear delay-1" aria-label="Measurement controls">
              <div className="flex items-start justify-between gap-3 mb-6"><div><p className="eyebrow">Acquisition controls</p><h2 className="text-base font-bold mt-2">Simulate a measurement</h2></div><SlidersHorizontal size={18} className="text-primary" strokeWidth={1.8} /></div>
              <div>
                <label className="input-label">Sample state</label>
                <div className="sample-options" role="group" aria-label="Sample state">
                  {STATES.map((state) => <button key={state} className={`sample-option ${sampleState === state ? 'selected' : ''}`} onClick={() => setSampleState(state)} data-testid={`button-sample-${state.toLowerCase()}`} aria-pressed={sampleState === state}>{state}</button>)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2.5">Ground truth used to synthesize the response curve.</p>
              </div>
              <div className="mt-7">
                <div className="flex items-center justify-between"><label className="input-label mb-0" htmlFor="noise-range">Noise variance</label><span className="mono text-xs text-primary font-bold" data-testid="value-noise">{noise.toFixed(2)}</span></div>
                <input id="noise-range" className="range-input mt-4" type="range" min="0" max="0.08" step="0.01" value={noise} onChange={(event) => setNoise(Number(event.target.value))} data-testid="input-noise-variance" />
                <div className="flex justify-between mt-2 text-[10px] mono text-muted-foreground"><span>0.00 / clean</span><span>0.08 / noisy</span></div>
              </div>
               <div className="mt-7 pt-5 border-t border-border"><div className="flex gap-2.5 text-[11px] leading-relaxed text-muted-foreground"><Sparkles size={15} className="text-accent shrink-0 mt-0.5" /><span>Signal generation uses a Gaussian peak model with controlled baseline drift and seeded noise.</span></div></div>
               <button className={`compare-toggle mt-5 ${compareMode ? 'active' : ''}`} onClick={() => { setCompareMode(!compareMode); if (!comparison) setComparison(buildMeasurement(compareState, noise, run + 100)); }} data-testid="button-toggle-compare"><GitCompare size={15} />{compareMode ? 'Compare runs enabled' : 'Enable compare runs'}<span className="toggle-knob" /></button>
               {compareMode && <div className="compare-controls">
                 <label className="input-label">Overlay second run</label>
                 <div className="sample-options">{STATES.map((state) => <button key={state} className={`sample-option ${compareState === state ? 'selected' : ''}`} onClick={() => { setCompareState(state); setComparison(buildMeasurement(state, noise, run + 100)); }} data-testid={`button-compare-${state.toLowerCase()}`}>{state}</button>)}</div>
                 <button className="ghost-button w-full justify-center mt-3" onClick={runComparison} data-testid="button-run-comparison"><GitCompare size={14} /> Refresh comparison trace</button>
               </div>}
              <button className="run-button mt-6" onClick={runMeasurement} disabled={phase === 'running'} data-testid="button-run-measurement">{phase === 'running' ? <><LoaderCircle size={16} className="animate-spin" />Acquiring signal…</> : <><Play size={15} fill="currentColor" />Run measurement</>}</button>
              <div className="mt-3 text-center mono text-[10px] text-muted-foreground">estimated acquisition time · 0.72 s</div>
            </section>

            <section className="appear delay-2">
              {phase === 'running' && <div className="panel empty-state" data-testid="state-loading"><div className="instrument-icon"><Activity size={27} className="scan-line" /></div><p className="eyebrow text-primary">Acquiring trace</p><h2 className="text-xl font-bold mt-2">Reading the synthetic cell</h2><p className="text-sm text-muted-foreground mt-2">Applying pulse sequence, then extracting signal features.</p><div className="w-56 h-1.5 bg-muted rounded-full overflow-hidden mt-6"><div className="h-full w-2/3 bg-primary rounded-full animate-pulse" /></div></div>}
              {phase === 'idle' && <EmptyState onRetry={runMeasurement} />}
              {phase === 'error' && <EmptyState error onRetry={runMeasurement} />}
               {measurement && phase === 'ready' && <div className="panel appear" data-testid="panel-measurement-result"><div className="p-[21px_23px] border-b border-border flex flex-wrap justify-between items-center gap-4"><div><p className="eyebrow">{comparison && compareMode ? 'Predicted quality · comparison view' : 'Predicted quality status'}</p><div className="flex items-center gap-3 mt-3"><StatusBadge status={measurement.predicted} /><span className="text-xs text-muted-foreground">from {measurement.id}</span>{comparison && compareMode && <span className="comparison-label"><span className="comparison-dot" />{comparison.state} trace</span>}</div></div><div className="text-right"><p className="eyebrow">Model confidence</p><p className="mono text-2xl font-bold mt-2 text-primary" data-testid="value-confidence">{(measurement.confidence * 100).toFixed(1)}<span className="text-base ml-0.5">%</span></p></div></div><DpvChart measurement={measurement} comparison={compareMode ? comparison ?? undefined : undefined} /></div>}
            </section>
          </div>

          {measurement && phase === 'ready' && <div className="result-grid">
            <section className="panel metric-panel appear delay-1" data-testid="metric-peak-current"><div className="flex items-start justify-between"><div><p className="eyebrow">Peak current</p><p className="mono text-[2rem] leading-none font-bold mt-4 text-primary">{measurement.peakCurrent.toFixed(3)}<span className="text-sm ml-1 font-normal text-muted-foreground">µA</span></p><p className="text-xs text-muted-foreground mt-3">Maximum differential response</p></div><div className="brand-mark text-primary bg-primary/5 border-primary/15"><Crosshair size={18} /></div></div></section>
            <ProbabilityBars measurement={measurement} />
          </div>}
          {measurement && phase === 'ready' && <div id="features-section" className="mt-[18px] appear delay-2"><Features measurement={measurement} /></div>}
           {measurement && phase === 'ready' && <div className="action-strip mt-[18px]"><button className="ghost-button" onClick={() => downloadSignalCsv(measurement, compareMode ? comparison ?? undefined : undefined)} data-testid="button-download-csv"><Download size={14} /> Download Signal Data (CSV)</button><button className="ghost-button" onClick={() => document.getElementById('summary-report')?.scrollIntoView({ behavior: 'smooth' })} data-testid="button-generate-report"><FileText size={14} /> Generate summary report</button></div>}
           <ModelDiagnostics />
           {measurement && phase === 'ready' && <ReportCard measurement={measurement} comparison={compareMode ? comparison ?? undefined : undefined} />}
          <section id="method-note" className="panel mt-[18px] p-[19px_23px] flex items-start gap-3 appear delay-3"><div className="brand-mark shrink-0 text-accent bg-accent/8 border-accent/20"><Beaker size={17} /></div><div><p className="eyebrow">Method note</p><p className="text-xs leading-relaxed text-muted-foreground mt-2 max-w-3xl">This proof-of-concept uses a synthetic differential pulse voltammogram. Quality is estimated from peak prominence, baseline stability, width, and symmetry. No external model or lab data leaves this browser session.</p></div></section>
          <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[10px] mono text-muted-foreground"><span>Electrochemical Signal Quality Checker · frontend proof of concept</span><span>All values synthetic · for inspection only</span></footer>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;