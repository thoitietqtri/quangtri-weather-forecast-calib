import { useMemo, useState } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './RainHourlyChart.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Tô màu cột theo đúng thang đã thống nhất cho mưa.
function rainBarColor(mm) {
  if (mm == null) return '#1565C0';
  if (mm <= 25) return '#1565C0';
  if (mm <= 50) return '#2E7D32';
  if (mm <= 100) return '#F9A825';
  return '#D32F2F';
}

// stations: [{ id, name, series: [{t, v}, ...] }, ...] — dùng chung dữ liệu
// đã tải cho RainHourlyTable, không cần gọi thêm API.
export default function RainHourlyChart({ stations, onClose }) {
  const [stationId, setStationId] = useState(stations[0]?.id || '');
  const station = stations.find((s) => s.id === stationId);

  const chartData = useMemo(() => {
    if (!station) return [];
    return [...station.series]
      .sort((a, b) => a.t - b.t)
      .map((p) => ({ time: formatTimeVN(p.t), value: p.v }));
  }, [station]);

  const tong72h = useMemo(() => chartData.reduce((s, p) => s + (p.value || 0), 0), [chartData]);

  return (
    <div className="rain-hourly-chart-overlay" onClick={onClose}>
      <div className="rain-hourly-chart-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rain-hourly-chart-header">
          <h3>📊 Biểu đồ mưa theo giờ</h3>
          <button className="rain-hourly-chart-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="rain-hourly-chart-controls">
          <label>Chọn trạm:</label>
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="rain-hourly-chart-body">
          {chartData.length === 0 ? (
            <div className="rain-hourly-chart-empty">⏳ Không có dữ liệu cho trạm này</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
                <XAxis dataKey="time" angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" tick={{ fontSize: 10, fill: '#fff' }} stroke="rgba(255,255,255,0.4)" />
                <YAxis tick={{ fontSize: 11, fill: '#fff' }} stroke="rgba(255,255,255,0.4)" label={{ value: 'mm', angle: -90, position: 'insideLeft', fill: '#fff' }} />
                <Tooltip contentStyle={{ background: '#0D1B2A', border: '1px solid #1565C0', color: '#fff' }} />
                <Bar dataKey="value">
                  {chartData.map((entry, i) => <Cell key={i} fill={rainBarColor(entry.value)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rain-hourly-chart-summary">
          <b>Tổng mưa 72h qua:</b> {Math.round(tong72h * 10) / 10}mm
        </div>
      </div>
    </div>
  );
}
