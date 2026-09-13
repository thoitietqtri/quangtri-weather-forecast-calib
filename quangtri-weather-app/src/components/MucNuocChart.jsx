import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import './MucNuocChart.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function findValueAt(sortedSeries, targetT) {
  let best = null; let bestDiff = Infinity;
  for (const p of sortedSeries) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= 40 * 60 * 1000 ? best.v : null;
}

function computeCuongSuat(sortedSeries, hours) {
  if (sortedSeries.length === 0) return null;
  const last = sortedSeries[sortedSeries.length - 1];
  const past = findValueAt(sortedSeries, last.t - hours * 3600 * 1000);
  if (past == null) return null;
  return Math.round(((last.v - past) / hours) * 1000) / 1000;
}

function trendText(cs) {
  if (cs == null) return '—';
  const sign = cs > 0 ? '+' : '';
  const arrow = cs > 0.02 ? '📈 Đang lên' : cs < -0.02 ? '📉 Đang xuống' : '➡️ Ổn định';
  return `${sign}${cs} m/h (${arrow})`;
}

// Vạch ngưỡng ngang — 3 vạch (BĐI/II/III) cho trạm có cấp báo động chính
// thức, 2 vạch (bình thường/nguy hiểm) cho trạm dùng ngưỡng tự quy định,
// không có vạch nào cho trạm chưa phân cấp (hồ chứa). Trả về MẢNG cấu hình
// thuần (không phải JSX) rồi map trực tiếp thành <ReferenceLine> ngay trong
// <AreaChart> — recharts KHÔNG nhận diện được nếu bọc qua component riêng.
function getAlertLines(alertInfo) {
  if (!alertInfo) return [];
  if (alertInfo.type === 'official') {
    return [
      { y: alertInfo.bd1, color: '#F9A825', label: 'BĐ I' },
      { y: alertInfo.bd2, color: '#EF6C00', label: 'BĐ II' },
      { y: alertInfo.bd3, color: '#D32F2F', label: 'BĐ III' },
    ];
  }
  return [
    { y: alertInfo.binhThuongMax, color: '#EF6C00', label: 'Cảnh báo' },
    { y: alertInfo.nguyHiemMin, color: '#D32F2F', label: 'Nguy hiểm' },
  ];
}

// stations: [{ id, name, alertInfo, series: [{t, v}] }, ...]
export default function MucNuocChart({ stations, onClose }) {
  const [stationId, setStationId] = useState(stations[0]?.id || '');
  const station = stations.find((s) => s.id === stationId);

  const sorted = useMemo(() => {
    if (!station) return [];
    return [...station.series].sort((a, b) => a.t - b.t);
  }, [station]);

  const chartData = sorted.map((p) => ({ time: formatTimeVN(p.t), value: p.v }));
  const cuongSuat1h = computeCuongSuat(sorted, 1);
  const cuongSuat3h = computeCuongSuat(sorted, 3);
  const cuongSuat6h = computeCuongSuat(sorted, 6);
  const alertLines = getAlertLines(station?.alertInfo);

  return (
    <div className="mucnuoc-chart-overlay" onClick={onClose}>
      <div className="mucnuoc-chart-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mucnuoc-chart-header">
          <h3>📉 Biểu đồ mực nước theo giờ</h3>
          <button className="mucnuoc-chart-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="mucnuoc-chart-controls">
          <label>Chọn trạm:</label>
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="mucnuoc-chart-body">
          {chartData.length === 0 ? (
            <div className="mucnuoc-chart-empty">⏳ Không có dữ liệu cho trạm này</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
                <XAxis dataKey="time" angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" tick={{ fontSize: 10, fill: '#fff' }} stroke="rgba(255,255,255,0.4)" />
                <YAxis tick={{ fontSize: 11, fill: '#fff' }} stroke="rgba(255,255,255,0.4)" label={{ value: 'm', angle: -90, position: 'insideLeft', fill: '#fff' }} />
                <Tooltip contentStyle={{ background: '#0D1B2A', border: '1px solid #1565C0', color: '#fff' }} />
                {alertLines.map((line) => (
                  <ReferenceLine
                    key={line.label}
                    y={line.y}
                    stroke={line.color}
                    strokeDasharray="4 4"
                    label={{ value: line.label, position: 'insideTopLeft', fill: line.color, fontSize: 10 }}
                  />
                ))}
                <Area type="monotone" dataKey="value" stroke="#42A5F5" strokeWidth={2} fill="#1565C0" fillOpacity={0.55} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mucnuoc-chart-cuongsuat">
          <div><b>Cường suất 1h:</b> {trendText(cuongSuat1h)}</div>
          <div><b>Cường suất 3h:</b> {trendText(cuongSuat3h)}</div>
          <div><b>Cường suất 6h:</b> {trendText(cuongSuat6h)}</div>
        </div>
      </div>
    </div>
  );
}
