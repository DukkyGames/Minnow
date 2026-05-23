/**
 * Default layout CSS injected into every reef widget iframe srcdoc.
 * Models often omit chart wrapper heights; Recharts ResponsiveContainer needs a sized parent.
 */
export const REEF_WIDGET_BASELINE_CSS = `
.rw { width: 100%; max-width: 100%; min-width: 0; }
.rw-chart,
.mw-chart {
  height: 220px;
  min-height: 220px;
  min-width: 0;
  width: 100%;
}
.rw-chart .recharts-responsive-container,
.mw-chart .recharts-responsive-container {
  width: 100% !important;
  height: 100% !important;
}
`.trim();
