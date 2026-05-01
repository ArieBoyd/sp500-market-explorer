// ============================================================
//  S&P 500 Market Explorer — main.js
//  Data: sp500_index.csv + sp500_companies.csv (Kaggle)
//  Techniques from "Interactive Visualization for the Web (D3)"
// ============================================================

// ── 1. SECTOR COLOR SCALE ────────────────────────────────────
// d3.scaleOrdinal maps categorical sector names → colors
const SECTOR_COLORS = {
  "Technology":             "#00d4aa",
  "Industrials":            "#0090ff",
  "Financial Services":     "#f0b429",
  "Healthcare":             "#a78bfa",
  "Consumer Cyclical":      "#fb923c",
  "Consumer Defensive":     "#34d399",
  "Utilities":              "#60a5fa",
  "Real Estate":            "#f472b6",
  "Communication Services": "#facc15",
  "Energy":                 "#ff6b6b",
  "Basic Materials":        "#a3e635",
};

// Fallback for any unexpected sector
const colorScale = d3.scaleOrdinal()
  .domain(Object.keys(SECTOR_COLORS))
  .range(Object.values(SECTOR_COLORS));

// ── 2. GLOBAL STATE ──────────────────────────────────────────
const state = {
  indexData:     [],   // [{date, value}, ...]
  companies:     [],   // [{symbol, sector, price, marketcap, revgrowth, ...}, ...]
  filteredComps: [],   // companies after sector filter
  activeYears:   "all",
  activeSector:  "all",
  topN:          15,
};

// ── 3. TOOLTIP ───────────────────────────────────────────────
const tooltip = d3.select("#tooltip");

function showTooltip(html, event) {
  tooltip.classed("visible", true).html(html);
  moveTooltip(event);
}
function moveTooltip(event) {
  tooltip
    .style("left", (event.clientX + 16) + "px")
    .style("top",  (event.clientY - 36) + "px");
}
function hideTooltip() {
  tooltip.classed("visible", false);
}

// ── 4. LOAD BOTH CSVs WITH Promise.all ──────────────────────
// Promise.all() fires both fetches simultaneously and waits
// for both to finish before proceeding — efficient and clean.
Promise.all([

  // File 1: S&P 500 index daily prices
  d3.csv("data/sp500_index.csv", d => ({
    date:  new Date(d.Date),     // string → Date
    value: +d["S&P500"],         // string → number
  })),

  // File 2: S&P 500 company fundamentals
  d3.csv("data/sp500_companies.csv", d => ({
    symbol:      d.Symbol,
    name:        d.Shortname,
    sector:      d.Sector,
    industry:    d.Industry,
    price:       +d.Currentprice,
    marketcap:   +d.Marketcap,
    ebitda:      +d.Ebitda,
    revgrowth:   +d.Revenuegrowth,
    employees:   +d.Fulltimeemployees,
    weight:      +d.Weight,
    city:        d.City,
    state:       d.State,
  }))

]).then(([indexData, companies]) => {

  // ── 5. STORE & CLEAN ───────────────────────────────────────
  // Filter out any rows with invalid price or marketcap
  state.indexData   = indexData.filter(d => !isNaN(d.value) && d.date instanceof Date);
  state.companies   = companies.filter(d => d.price > 0 && d.marketcap > 0);
  state.filteredComps = state.companies;

  // ── 6. UPDATE HEADER STATS ────────────────────────────────
  const sectors   = [...new Set(state.companies.map(d => d.sector))];
  const minVal    = d3.min(state.indexData, d => d.value);
  const maxVal    = d3.max(state.indexData, d => d.value);

  d3.select("#stat-companies").text(`${state.companies.length} companies`);
  d3.select("#stat-sectors").text(`${sectors.length} sectors`);
  d3.select("#stat-range").text(`$${minVal.toFixed(0)} – $${maxVal.toFixed(0)}`);

  // ── 7. POPULATE SECTOR FILTER DROPDOWN ───────────────────
  const sectorSelect = d3.select("#scatter-sector-filter");
  sectors.sort().forEach(s => {
    sectorSelect.append("option").attr("value", s).text(s);
  });

  sectorSelect.on("change", function () {
    state.activeSector  = this.value;
    state.filteredComps = state.activeSector === "all"
      ? state.companies
      : state.companies.filter(d => d.sector === state.activeSector);
    renderScatter();
  });

  // ── 8. WIRE UP TIME-RANGE BUTTONS ────────────────────────
  d3.selectAll(".range-btn").on("click", function () {
    d3.selectAll(".range-btn").classed("active", false);
    d3.select(this).classed("active", true);
    state.activeYears = d3.select(this).attr("data-years");
    renderLineChart();
  });

  // ── 9. WIRE UP TOP-N SELECT ──────────────────────────────
  d3.select("#top-n-select").on("change", function () {
    state.topN = +this.value;
    renderMarketCapChart();
  });

  // ── 10. INITIAL RENDER ────────────────────────────────────
  renderLineChart();
  renderSectorChart();
  renderScatter();
  renderMarketCapChart();

}).catch(err => {
  console.error("Failed to load data:", err);
  document.querySelector(".charts-grid").innerHTML =
    `<div style="padding:40px;color:#ff6b6b;font-family:monospace">
      ⚠ Could not load CSV files. Make sure sp500_index.csv and sp500_companies.csv
      are in the data/ folder and you're running via a local server (not file://).
    </div>`;
});

// ════════════════════════════════════════════════════════════
//  CHART 1 — LINE CHART: S&P 500 Index Price History
//  Techniques: scaleTime, scaleLinear, d3.line(), area fill,
//              animated path, crosshair on hover
// ════════════════════════════════════════════════════════════
function renderLineChart() {
  const el = document.getElementById("line-chart");
  d3.select("#line-chart").selectAll("*").remove();

  const W = el.clientWidth || 900;
  const H = 300;
  const m = { top: 12, right: 24, bottom: 36, left: 62 };
  const iW = W - m.left - m.right;
  const iH = H - m.top - m.bottom;

  // Filter data by selected year range
  const now     = d3.max(state.indexData, d => d.date);
  const cutoff  = state.activeYears === "all"
    ? d3.min(state.indexData, d => d.date)
    : new Date(now.getFullYear() - +state.activeYears, now.getMonth(), now.getDate());

  const data = state.indexData.filter(d => d.date >= cutoff);
  if (!data.length) return;

  const svg = d3.select("#line-chart")
    .append("svg").attr("width", W).attr("height", H);

  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Scales
  const xScale = d3.scaleTime()
    .domain(d3.extent(data, d => d.date))
    .range([0, iW]);

  const yScale = d3.scaleLinear()
    .domain([d3.min(data, d => d.value) * 0.96, d3.max(data, d => d.value) * 1.02])
    .range([iH, 0]);

  // Grid lines
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(yScale).tickSize(-iW).tickFormat("").ticks(5));

  // Area fill under the line (gradient)
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient")
    .attr("id", "area-gradient")
    .attr("gradientUnits", "userSpaceOnUse")
    .attr("x1", 0).attr("y1", m.top)
    .attr("x2", 0).attr("y2", m.top + iH);

  grad.append("stop").attr("offset", "0%")
    .attr("stop-color", "#00d4aa").attr("stop-opacity", 0.18);
  grad.append("stop").attr("offset", "100%")
    .attr("stop-color", "#00d4aa").attr("stop-opacity", 0);

  // Area generator
  const areaGen = d3.area()
    .x(d => xScale(d.date))
    .y0(iH)
    .y1(d => yScale(d.value))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("fill", "url(#area-gradient)")
    .attr("d", areaGen);

  // Line generator
  const lineGen = d3.line()
    .x(d => xScale(d.date))
    .y(d => yScale(d.value))
    .curve(d3.curveMonotoneX);

  const path = g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#00d4aa")
    .attr("stroke-width", 2)
    .attr("d", lineGen);

  // Animate the line drawing (stroke-dashoffset trick)
  const totalLen = path.node().getTotalLength();
  path
    .attr("stroke-dasharray", `${totalLen} ${totalLen}`)
    .attr("stroke-dashoffset", totalLen)
    .transition().duration(1000).ease(d3.easeCubicInOut)
    .attr("stroke-dashoffset", 0);

  // Axes
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat("%b '%y")));

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `$${d3.format(",")(d)}`));

  // ── Crosshair + hover overlay ────────────────────────────
  const crossV = g.append("line")
    .attr("stroke", "#2e3a48").attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3")
    .attr("y1", 0).attr("y2", iH).attr("opacity", 0);

  const crossDot = g.append("circle")
    .attr("r", 5).attr("fill", "#00d4aa")
    .attr("stroke", "#0a0d12").attr("stroke-width", 2)
    .attr("opacity", 0);

  // Bisector helps find the nearest data point to the cursor
  const bisect = d3.bisector(d => d.date).left;

  g.append("rect")
    .attr("width", iW).attr("height", iH)
    .attr("fill", "none").attr("pointer-events", "all")
    .on("mousemove", function (event) {
      const [mx] = d3.pointer(event);
      const x0   = xScale.invert(mx);
      const i    = bisect(data, x0, 1);
      const d    = data[i] || data[data.length - 1];

      crossV.attr("x1", xScale(d.date)).attr("x2", xScale(d.date)).attr("opacity", 1);
      crossDot.attr("cx", xScale(d.date)).attr("cy", yScale(d.value)).attr("opacity", 1);

      showTooltip(
        `<strong>S&amp;P 500</strong>
         ${d3.timeFormat("%B %d, %Y")(d.date)}<br>
         Close: <span style="color:#00d4aa">$${d3.format(",.2f")(d.value)}</span>`,
        event
      );
    })
    .on("mouseleave", () => {
      crossV.attr("opacity", 0);
      crossDot.attr("opacity", 0);
      hideTooltip();
    });
}

// ════════════════════════════════════════════════════════════
//  CHART 2 — SECTOR BAR CHART
//  Techniques: d3.rollup(), scaleBand, grouped data,
//              click interaction to filter scatter
// ════════════════════════════════════════════════════════════
function renderSectorChart() {
  const el = document.getElementById("sector-chart");
  d3.select("#sector-chart").selectAll("*").remove();

  const W = el.clientWidth || 420;
  const H = 340;
  const m = { top: 10, right: 16, bottom: 40, left: 155 };
  const iW = W - m.left - m.right;
  const iH = H - m.top - m.bottom;

  // Aggregate: count and avg market cap per sector
  const sectorData = Array.from(
    d3.rollup(state.companies,
      rows => ({
        count:     rows.length,
        avgMcap:   d3.mean(rows, d => d.marketcap),
      }),
      d => d.sector
    ),
    ([sector, vals]) => ({ sector, ...vals })
  ).sort((a, b) => b.count - a.count);

  const svg = d3.select("#sector-chart")
    .append("svg").attr("width", W).attr("height", H);

  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Scales
  const xScale = d3.scaleLinear()
    .domain([0, d3.max(sectorData, d => d.count)])
    .range([0, iW]);

  const yScale = d3.scaleBand()
    .domain(sectorData.map(d => d.sector))
    .range([0, iH])
    .padding(0.28);

  // Axes
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d => d));

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(yScale));

  // Bars
  g.selectAll(".bar")
    .data(sectorData)
    .join("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", d => yScale(d.sector))
    .attr("height", yScale.bandwidth())
    .attr("rx", 4)
    .attr("fill", d => colorScale(d.sector))
    .attr("opacity", 0.8)
    .attr("cursor", "pointer")
    .attr("width", 0)
    .on("mouseover", function (event, d) {
      d3.select(this).attr("opacity", 1);
      showTooltip(
        `<strong>${d.sector}</strong>
         Companies: ${d.count}<br>
         Avg Mkt Cap: $${d3.format(".2s")(d.avgMcap)}`,
        event
      );
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", function () { d3.select(this).attr("opacity", 0.8); hideTooltip(); })
    // Click: filter the scatter plot to this sector
    .on("click", function (event, d) {
      const isSame = state.activeSector === d.sector;
      state.activeSector  = isSame ? "all" : d.sector;
      state.filteredComps = state.activeSector === "all"
        ? state.companies
        : state.companies.filter(c => c.sector === state.activeSector);

      // Sync the dropdown
      d3.select("#scatter-sector-filter").property("value", state.activeSector);

      // Highlight clicked bar
      g.selectAll(".bar").attr("opacity", b =>
        state.activeSector === "all" || b.sector === state.activeSector ? 0.8 : 0.25
      );

      renderScatter();
    })
    .transition().duration(700).ease(d3.easeCubicOut)
    .attr("width", d => xScale(d.count));

  // Count labels on bars
  g.selectAll(".bar-label")
    .data(sectorData)
    .join("text")
    .attr("class", "bar-label")
    .attr("x", d => xScale(d.count) + 5)
    .attr("y", d => yScale(d.sector) + yScale.bandwidth() / 2 + 4)
    .attr("fill", "#5a6a7a")
    .attr("font-size", 11)
    .attr("font-family", "'DM Mono', monospace")
    .text(d => d.count);
}

// ════════════════════════════════════════════════════════════
//  CHART 3 — SCATTER PLOT: Revenue Growth vs. Current Price
//  Techniques: scaleLog, scaleSqrt (bubble size),
//              color by sector, zoom/filter interaction
// ════════════════════════════════════════════════════════════
function renderScatter() {
  const el = document.getElementById("scatter-chart");
  d3.select("#scatter-chart").selectAll("*").remove();
  d3.select("#scatter-legend").selectAll("*").remove();

  const W = el.clientWidth || 420;
  const H = 320;
  const m = { top: 12, right: 16, bottom: 48, left: 62 };
  const iW = W - m.left - m.right;
  const iH = H - m.top - m.bottom;

  // Remove extreme outliers for better readability
  // Keep revgrowth in [-0.5, 1.5] and price < 2000
  const data = state.filteredComps.filter(d =>
    d.revgrowth >= -0.5 && d.revgrowth <= 1.5 &&
    d.price > 0 && d.price < 2000 &&
    d.marketcap > 0
  );

  if (!data.length) return;

  const svg = d3.select("#scatter-chart")
    .append("svg").attr("width", W).attr("height", H);

  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Scales
  const xScale = d3.scaleLinear()
    .domain([d3.min(data, d => d.revgrowth) - 0.05, d3.max(data, d => d.revgrowth) + 0.05])
    .range([0, iW]);

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.price) * 1.08])
    .range([iH, 0]);

  // Bubble radius = sqrt scale of market cap (so area is proportional)
  const rScale = d3.scaleSqrt()
    .domain([0, d3.max(data, d => d.marketcap)])
    .range([3, 22]);

  // Grid
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(yScale).tickSize(-iW).tickFormat("").ticks(5));

  // Zero revenue growth line
  g.append("line")
    .attr("x1", xScale(0)).attr("x2", xScale(0))
    .attr("y1", 0).attr("y2", iH)
    .attr("stroke", "#2e3a48")
    .attr("stroke-dasharray", "4,3")
    .attr("stroke-width", 1);

  // Axes
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(6).tickFormat(d => `${(d * 100).toFixed(0)}%`));

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `$${d}`));

  // Axis labels
  g.append("text")
    .attr("x", iW / 2).attr("y", iH + 40)
    .attr("text-anchor", "middle")
    .attr("fill", "#5a6a7a").attr("font-size", 11)
    .attr("font-family", "'DM Mono', monospace")
    .text("Revenue Growth (YoY %)");

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -50)
    .attr("text-anchor", "middle")
    .attr("fill", "#5a6a7a").attr("font-size", 11)
    .attr("font-family", "'DM Mono', monospace")
    .text("Current Price ($)");

  // Bubbles
  g.selectAll(".bubble")
    .data(data)
    .join("circle")
    .attr("class", "bubble")
    .attr("cx", d => xScale(d.revgrowth))
    .attr("cy", d => yScale(d.price))
    .attr("fill", d => colorScale(d.sector))
    .attr("opacity", 0.65)
    .attr("stroke", d => colorScale(d.sector))
    .attr("stroke-width", 1)
    .attr("r", 0)
    .on("mouseover", function (event, d) {
      d3.select(this).attr("opacity", 1).attr("stroke-width", 2).raise();
      showTooltip(
        `<strong>${d.symbol}</strong>
         ${d.name}<br>
         Sector: ${d.sector}<br>
         Price: $${d.price.toFixed(2)}<br>
         Rev Growth: ${(d.revgrowth * 100).toFixed(1)}%<br>
         Mkt Cap: $${d3.format(".3s")(d.marketcap)}`,
        event
      );
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", function () {
      d3.select(this).attr("opacity", 0.65).attr("stroke-width", 1);
      hideTooltip();
    })
    .transition().duration(500).ease(d3.easeBackOut.overshoot(1.2))
    .attr("r", d => rScale(d.marketcap));

  // Legend — one dot per unique sector in current filtered data
  const sectors = [...new Set(data.map(d => d.sector))].sort();
  const legend  = d3.select("#scatter-legend");

  sectors.forEach(s => {
    const item = legend.append("div").attr("class", "legend-item")
      .on("click", () => {
        state.activeSector  = state.activeSector === s ? "all" : s;
        state.filteredComps = state.activeSector === "all"
          ? state.companies
          : state.companies.filter(d => d.sector === state.activeSector);
        d3.select("#scatter-sector-filter").property("value", state.activeSector);
        renderScatter();
      });
    item.append("div").attr("class", "legend-dot")
      .style("background", colorScale(s));
    item.append("span").text(s);
  });
}

// ════════════════════════════════════════════════════════════
//  CHART 4 — TOP N MARKET CAP HORIZONTAL BAR
//  Techniques: dynamic topN, scaleBand, value labels,
//              color by sector, select interaction
// ════════════════════════════════════════════════════════════
function renderMarketCapChart() {
  const el = document.getElementById("marketcap-chart");
  d3.select("#marketcap-chart").selectAll("*").remove();

  const W = el.clientWidth || 900;
  const H = 36 * state.topN + 60;
  const m = { top: 10, right: 100, bottom: 36, left: 72 };
  const iW = W - m.left - m.right;
  const iH = H - m.top - m.bottom;

  const data = [...state.companies]
    .sort((a, b) => b.marketcap - a.marketcap)
    .slice(0, state.topN);

  const svg = d3.select("#marketcap-chart")
    .append("svg").attr("width", W).attr("height", H);

  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Scales
  const xScale = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.marketcap)])
    .range([0, iW]);

  const yScale = d3.scaleBand()
    .domain(data.map(d => d.symbol))
    .range([0, iH])
    .padding(0.25);

  // Axes
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d => `$${d3.format(".2s")(d)}`));

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(yScale));

  // Bars
  g.selectAll(".bar")
    .data(data)
    .join("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", d => yScale(d.symbol))
    .attr("height", yScale.bandwidth())
    .attr("rx", 4)
    .attr("fill", d => colorScale(d.sector))
    .attr("opacity", 0.82)
    .attr("width", 0)
    .on("mouseover", function (event, d) {
      d3.select(this).attr("opacity", 1);
      showTooltip(
        `<strong>${d.symbol}</strong>
         ${d.name}<br>
         Sector: ${d.sector}<br>
         Mkt Cap: $${d3.format(".3s")(d.marketcap)}<br>
         Price: $${d.price.toFixed(2)}<br>
         Rev Growth: ${(d.revgrowth * 100).toFixed(1)}%`,
        event
      );
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", function () { d3.select(this).attr("opacity", 0.82); hideTooltip(); })
    .transition().duration(700).ease(d3.easeCubicOut)
    .delay((_, i) => i * 30)
    .attr("width", d => xScale(d.marketcap));

  // Value labels
  g.selectAll(".bar-val")
    .data(data)
    .join("text")
    .attr("class", "bar-val")
    .attr("x", d => xScale(d.marketcap) + 6)
    .attr("y", d => yScale(d.symbol) + yScale.bandwidth() / 2 + 4)
    .attr("fill", "#5a6a7a")
    .attr("font-size", 11)
    .attr("font-family", "'DM Mono', monospace")
    .text(d => `$${d3.format(".2s")(d.marketcap)}`);
}

// ── RESIZE ────────────────────────────────────────────────
let _resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    renderLineChart();
    renderSectorChart();
    renderScatter();
    renderMarketCapChart();
  }, 200);
});
