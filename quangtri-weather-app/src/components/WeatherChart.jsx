import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import './WeatherChart.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function WeatherChart({ hourly, regionName }) {
  if (!hourly?.time) return null;

  const labels = hourly.time.slice(0, 24).map(t => t.split('T')[1]);
  const temps = hourly.temperature_2m.slice(0, 24);
  const rains = hourly.precipitation.slice(0, 24);
  const winds = hourly.windspeed_10m.slice(0, 24);

  const data = {
    labels,
    datasets: [
      { label: '🌡️ Nhiệt độ (°C)', data: temps, backgroundColor: 'red', yAxisID: 'y' },
      { label: '☔ Mưa (mm)', data: rains, backgroundColor: 'blue', yAxisID: 'y1' },
      { label: '💨 Gió (km/h)', data: winds, backgroundColor: 'gold', yAxisID: 'y2' },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => `${regionName} - ${items[0].label}`,
        },
      },
    },
    scales: {
      y: { type: 'linear', position: 'left' },
      y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } },
      y2: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, offset: true },
    },
  };

  return (
    <div className="chart-container">
      <Bar data={data} options={options} />
    </div>
  );
}

export default WeatherChart;
