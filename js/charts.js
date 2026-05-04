// Chart.js wrapper. Stores one instance per canvas ID and destroys before recreating.

const _instances = {};

function renderProgressionChart(canvasId, history, category) {
  if (_instances[canvasId]) {
    _instances[canvasId].destroy();
    delete _instances[canvasId];
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (history.length === 0) {
    const ctx2d = canvas.getContext('2d');
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = '#9ca3af';
    ctx2d.font = '14px sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('No match data for this category.', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Default to a tight [3.0, 4.0] window — most ratings sit there and the
  // wider DUPR scale makes small swings invisible. Expand outward in 0.5
  // steps while data is within 0.2 of an edge; bounds only grow.
  const PAD = 0.2, STEP = 0.5;
  let lower = 3.0, upper = 4.0;
  const ratings = history.map(h => h.rating);
  const dataMax = Math.max(...ratings);
  const dataMin = Math.min(...ratings);
  while (dataMax > upper - PAD) upper += STEP;
  while (dataMin < lower + PAD) lower -= STEP;

  const ctx = canvas.getContext('2d');
  _instances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        label: `${category} Rating`,
        data: history.map(h => h.rating),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.08)',
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          min: lower,
          max: upper,
          ticks: {
            callback: v => v.toFixed(3),
            stepSize: 0.5,
          },
          title: { display: true, text: 'Rating' },
        },
        x: {
          title: { display: true, text: 'Date' },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => `Rating: ${ctx.parsed.y.toFixed(3)}`,
          },
        },
        legend: { display: false },
      },
    },
  });
}

function destroyChart(canvasId) {
  if (_instances[canvasId]) {
    _instances[canvasId].destroy();
    delete _instances[canvasId];
  }
}

function destroyAll() {
  for (const id of Object.keys(_instances)) {
    _instances[id].destroy();
  }
  for (const id of Object.keys(_instances)) {
    delete _instances[id];
  }
}

const Charts = { renderProgressionChart, destroyChart, destroyAll };
export default Charts;
