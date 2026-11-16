import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ConstituencyMatrixCell, ConstituencyTurnout } from '../types/trustcast';

type SortMode = 'turnout_desc' | 'turnout_asc' | 'alpha';

interface HeatmapDatum {
  constituency: string;
  column: string;
  registered: number;
  voted: number;
  turnout_pct: number;
  isOverall: boolean;
}

interface TooltipState {
  datum: HeatmapDatum;
  x: number;
  y: number;
}

interface ConstituencyHeatmapProps {
  constituencies: ConstituencyTurnout[];
  matrix: ConstituencyMatrixCell[];
  selectedConstituency: string | null;
  onSelectConstituency: (constituency: string | null) => void;
}

const AGE_COLUMNS = ['18-24', '25-34', '35-49', '50-64', '65+'];
const ALL_COLUMNS = ['Overall', ...AGE_COLUMNS];

function getDensityLabel(pct: number, registered: number): string {
  if (registered === 0) return 'No Enrolled Roll';
  if (pct >= 75) return 'High Turnout';
  if (pct >= 50) return 'Moderate-High';
  if (pct >= 25) return 'Developing';
  return 'Low Turnout';
}

export const ConstituencyHeatmap: React.FC<ConstituencyHeatmapProps> = ({
  constituencies,
  matrix,
  selectedConstituency,
  onSelectConstituency,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('turnout_desc');
  const [containerWidth, setContainerWidth] = useState<number>(760);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sortedConstituencies = useMemo(() => {
    const copy = [...constituencies];
    if (sortMode === 'turnout_desc') {
      copy.sort((a, b) => b.turnout_pct - a.turnout_pct || a.constituency.localeCompare(b.constituency));
    } else if (sortMode === 'turnout_asc') {
      copy.sort((a, b) => a.turnout_pct - b.turnout_pct || a.constituency.localeCompare(b.constituency));
    } else {
      copy.sort((a, b) => a.constituency.localeCompare(b.constituency));
    }
    return copy;
  }, [constituencies, sortMode]);

  const heatmapCells = useMemo<HeatmapDatum[]>(() => {
    const matrixMap = new Map<string, ConstituencyMatrixCell>();
    for (const cell of matrix) {
      matrixMap.set(`${cell.constituency}::${cell.age_group}`, cell);
    }

    const cells: HeatmapDatum[] = [];
    for (const con of sortedConstituencies) {
      cells.push({
        constituency: con.constituency,
        column: 'Overall',
        registered: con.registered,
        voted: con.voted,
        turnout_pct: con.turnout_pct,
        isOverall: true,
      });

      for (const age of AGE_COLUMNS) {
        const match = matrixMap.get(`${con.constituency}::${age}`);
        cells.push({
          constituency: con.constituency,
          column: age,
          registered: match?.registered ?? 0,
          voted: match?.voted ?? 0,
          turnout_pct: match?.turnout_pct ?? 0,
          isOverall: false,
        });
      }
    }
    return cells;
  }, [sortedConstituencies, matrix]);

  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode) return;

    const svg = d3.select(svgNode);
    svg.selectAll('*').remove();

    if (sortedConstituencies.length === 0) return;

    const rowNames = sortedConstituencies.map((c) => c.constituency);
    const width = Math.max(620, containerWidth);
    const margin = { top: 44, right: 20, bottom: 58, left: 156 };
    const rowHeight = 42;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = rowNames.length * rowHeight;
    const totalHeight = innerHeight + margin.top + margin.bottom;

    svg
      .attr('viewBox', `0 0 ${width} ${totalHeight}`)
      .attr('width', width)
      .attr('height', totalHeight);

    const xScale = d3
      .scaleBand<string>()
      .domain(ALL_COLUMNS)
      .range([0, innerWidth])
      .padding(0.1);

    const yScale = d3
      .scaleBand<string>()
      .domain(rowNames)
      .range([0, innerHeight])
      .padding(0.16);

    const colorScale = d3
      .scaleSequential((t) =>
        d3.interpolateRgbBasis(['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'])(t)
      )
      .domain([0, 100]);

    const rootG = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Column headers
    const colHeaderGroup = rootG.append('g').attr('class', 'heatmap-col-headers');
    colHeaderGroup
      .selectAll('text')
      .data(ALL_COLUMNS)
      .enter()
      .append('text')
      .attr('x', (col) => (xScale(col) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', -14)
      .attr('text-anchor', 'middle')
      .attr('fill', (col) => (col === 'Overall' ? '#1d4ed8' : '#475569'))
      .attr('font-family', (col) => (col === 'Overall' ? 'DM Sans, sans-serif' : 'JetBrains Mono, monospace'))
      .attr('font-size', '12px')
      .attr('font-weight', (col) => (col === 'Overall' ? '700' : '600'))
      .text((col) => (col === 'Overall' ? 'Overall' : `Age ${col}`));

    // Divider line separating Overall turnout from age cohort breakdown
    const overallX = xScale('Overall') ?? 0;
    const firstAgeX = xScale(AGE_COLUMNS[0]) ?? 0;
    const dividerX = (overallX + xScale.bandwidth() + firstAgeX) / 2;
    rootG
      .append('line')
      .attr('x1', dividerX)
      .attr('x2', dividerX)
      .attr('y1', -26)
      .attr('y2', innerHeight + 4)
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3');

    // Row labels (interactive click to filter/pin constituency)
    const rowLabelGroup = rootG.append('g').attr('class', 'heatmap-row-labels');
    rowLabelGroup
      .selectAll('text')
      .data(sortedConstituencies)
      .enter()
      .append('text')
      .attr('x', -12)
      .attr('y', (d) => (yScale(d.constituency) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', (d) => (selectedConstituency === d.constituency ? '#1d4ed8' : '#0f172a'))
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', '12.5px')
      .attr('font-weight', (d) => (selectedConstituency === d.constituency ? '700' : '500'))
      .style('cursor', 'pointer')
      .text((d) => d.constituency)
      .on('click', (_event, d) => {
        onSelectConstituency(selectedConstituency === d.constituency ? null : d.constituency);
      });

    // Cells
    const cellGroups = rootG
      .selectAll<SVGGElement, HeatmapDatum>('g.heatmap-cell')
      .data(heatmapCells, (d) => `${d.constituency}::${d.column}`)
      .enter()
      .append('g')
      .attr('class', 'heatmap-cell')
      .attr('transform', (d) => `translate(${xScale(d.column) ?? 0}, ${yScale(d.constituency) ?? 0})`)
      .style('cursor', 'pointer')
      .style('opacity', (d) =>
        selectedConstituency && selectedConstituency !== d.constituency ? 0.38 : 1
      );

    cellGroups
      .append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', (d) => (d.registered === 0 ? '#f8fafc' : colorScale(d.turnout_pct)))
      .attr('stroke', (d) => {
        if (selectedConstituency === d.constituency) return '#1d4ed8';
        if (d.registered === 0) return '#e2e8f0';
        return d.isOverall ? '#93c5fd' : '#ffffff';
      })
      .attr('stroke-width', (d) => {
        if (selectedConstituency === d.constituency) return 2;
        return d.isOverall ? 1.5 : 1;
      })
      .attr('stroke-dasharray', (d) => (d.registered === 0 ? '3 2' : 'none'));

    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '11.5px')
      .attr('font-weight', (d) => (d.isOverall ? '700' : '600'))
      .attr('fill', (d) => {
        if (d.registered === 0) return '#94a3b8';
        return d.turnout_pct >= 52 ? '#ffffff' : '#0f172a';
      })
      .style('pointer-events', 'none')
      .text((d) => (d.registered === 0 ? '—' : `${d.turnout_pct.toFixed(0)}%`));

    // Interactive hover + click handlers
    cellGroups
      .on('mouseenter', function (event: MouseEvent, d) {
        d3.select(this)
          .select('rect')
          .attr('stroke', '#0f172a')
          .attr('stroke-width', 2.2);

        const containerRect = containerRef.current?.getBoundingClientRect();
        const relX = containerRect ? event.clientX - containerRect.left : 0;
        const relY = containerRect ? event.clientY - containerRect.top : 0;
        setTooltip({ datum: d, x: relX, y: relY });
      })
      .on('mousemove', function (event: MouseEvent, d) {
        const containerRect = containerRef.current?.getBoundingClientRect();
        const relX = containerRect ? event.clientX - containerRect.left : 0;
        const relY = containerRect ? event.clientY - containerRect.top : 0;
        setTooltip({ datum: d, x: relX, y: relY });
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this)
          .select('rect')
          .attr('stroke', () => {
            if (selectedConstituency === d.constituency) return '#1d4ed8';
            if (d.registered === 0) return '#e2e8f0';
            return d.isOverall ? '#93c5fd' : '#ffffff';
          })
          .attr('stroke-width', () => {
            if (selectedConstituency === d.constituency) return 2;
            return d.isOverall ? 1.5 : 1;
          });
        setTooltip(null);
      })
      .on('click', (_event, d) => {
        onSelectConstituency(selectedConstituency === d.constituency ? null : d.constituency);
      });

    // D3 Continuous Turnout Density Color Scale Legend
    const legendWidth = Math.min(260, innerWidth * 0.55);
    const legendHeight = 10;
    const legendGroup = rootG
      .append('g')
      .attr('transform', `translate(0, ${innerHeight + 22})`);

    const defs = svg.append('defs');
    const gradientId = 'trustcast-turnout-density-gradient';
    const gradient = defs
      .append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%')
      .attr('x2', '100%')
      .attr('y1', '0%')
      .attr('y2', '0%');

    d3.range(0, 1.01, 0.2).forEach((t) => {
      gradient
        .append('stop')
        .attr('offset', `${Math.round(t * 100)}%`)
        .attr('stop-color', colorScale(t * 100));
    });

    legendGroup
      .append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .attr('rx', 3)
      .attr('fill', `url(#${gradientId})`)
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 0.75);

    const legendScale = d3.scaleLinear().domain([0, 100]).range([0, legendWidth]);
    const legendAxis = d3
      .axisBottom(legendScale)
      .tickValues([0, 25, 50, 75, 100])
      .tickFormat((val) => `${val}%`)
      .tickSize(4);

    const axisG = legendGroup
      .append('g')
      .attr('transform', `translate(0, ${legendHeight})`)
      .call(legendAxis);

    axisG.select('.domain').remove();
    axisG
      .selectAll('text')
      .attr('fill', '#64748b')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px');
    axisG.selectAll('line').attr('stroke', '#94a3b8');

    // Empty / Unenrolled cohort legend item
    const noDataX = legendWidth + 24;
    if (noDataX + 120 <= innerWidth) {
      legendGroup
        .append('rect')
        .attr('x', noDataX)
        .attr('y', -1)
        .attr('width', 14)
        .attr('height', 12)
        .attr('rx', 3)
        .attr('fill', '#f8fafc')
        .attr('stroke', '#cbd5e1')
        .attr('stroke-dasharray', '3 2');

      legendGroup
        .append('text')
        .attr('x', noDataX + 20)
        .attr('y', 8)
        .attr('fill', '#64748b')
        .attr('font-family', 'DM Sans, sans-serif')
        .attr('font-size', '11px')
        .text('No enrolled voters in cohort');
    }
  }, [
    sortedConstituencies,
    heatmapCells,
    containerWidth,
    selectedConstituency,
    onSelectConstituency,
  ]);

  const selectedSummary = useMemo(
    () => constituencies.find((c) => c.constituency === selectedConstituency) || null,
    [constituencies, selectedConstituency]
  );

  return (
    <section className="civic-card rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Constituency Voter Turnout Density Heat Map
          </h2>
          <p className="text-xs text-slate-500">
            Interactive D3 matrix mapping ballot participation density across constituencies and age cohorts. Hover for counts or click a row to pin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedSummary && (
            <button
              type="button"
              onClick={() => onSelectConstituency(null)}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 whitespace-nowrap"
            >
              Pinned: {selectedSummary.constituency} ({selectedSummary.turnout_pct.toFixed(1)}%) · Clear
            </button>
          )}
          <label htmlFor="heatmap-sort" className="sr-only">
            Sort constituencies
          </label>
          <select
            id="heatmap-sort"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
          >
            <option value="turnout_desc">Sort: Highest Turnout</option>
            <option value="turnout_asc">Sort: Lowest Turnout</option>
            <option value="alpha">Sort: Constituency A–Z</option>
          </select>
        </div>
      </div>

      <div ref={containerRef} className="relative w-full overflow-x-auto">
        <svg
          ref={svgRef}
          role="img"
          aria-label="Interactive D3 heat map of voter turnout density by constituency and age group"
          className="block select-none"
        />

        {tooltip && (
          <div
            role="status"
            className="pointer-events-none absolute z-30 w-56 rounded-xl border border-slate-800 bg-slate-900/95 px-3.5 py-2.5 text-xs text-slate-100 shadow-lg"
            style={{
              left: Math.min(Math.max(12, tooltip.x + 14), Math.max(12, containerWidth - 236)),
              top: Math.max(8, tooltip.y - 78),
            }}
          >
            <div className="font-semibold text-white">{tooltip.datum.constituency}</div>
            <div className="mt-0.5 text-[11px] text-slate-300">
              {tooltip.datum.isOverall ? 'All Age Cohorts (Overall)' : `Age Cohort: ${tooltip.datum.column}`}
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-slate-700/80 pt-1.5">
              <span className="text-slate-300">Turnout Density</span>
              <span className="font-mono-tabular text-sm font-bold text-blue-300">
                {tooltip.datum.registered === 0 ? '—' : `${tooltip.datum.turnout_pct.toFixed(1)}%`}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
              <span>Ballots / Roll</span>
              <span className="font-mono-tabular font-medium text-white">
                {tooltip.datum.voted} / {tooltip.datum.registered}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Tier: {getDensityLabel(tooltip.datum.turnout_pct, tooltip.datum.registered)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
