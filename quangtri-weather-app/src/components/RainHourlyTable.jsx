import { useMemo } from 'react';
import './RainHourlyTable.css';

function formatTime(t) {
  const d = new Date(t + 7 * 3600 * 1000); // dịch sang giờ VN trước khi đọc field UTC
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Ngưỡng màu — dùng đúng thang đã thống nhất ở Bảng mưa thực đo (theo thời
// đoạn) để đồng bộ trực quan trong toàn app.
function rainColor(mm) {
  if (mm == null) return { bg: '#1565C0', fg: '#fff' };
  if (mm <= 25) return { bg: '#1565C0', fg: '#fff' };
  if (mm <= 50) return { bg: '#2E7D32', fg: '#fff' };
  if (mm <= 100) return { bg: '#F9A825', fg: '#000' };
  return { bg: '#D32F2F', fg: '#fff' };
}

// stations: [{ id, name, series: [{t, v}, ...] }, ...]
// Bảng dạng hàng=giờ, cột=trạm — giống hệt bố cục MucNuocTable, nhưng đây
// là mưa THEO TỪNG GIỜ (không cộng dồn cửa sổ như Bảng mưa thực đo cũ).
export default function RainHourlyTable({ stations, onClose }) {
  const { times, rows } = useMemo(() => {
    const timeSet = new Set();
    for (const s of stations) for (const p of s.series) timeSet.add(p.t);
    const sortedTimes = [...timeSet].sort((a, b) => b - a); // mới nhất lên đầu

    const valueMap = {};
    for (const s of stations) for (const p of s.series) valueMap[`${p.t}|${s.id}`] = p.v;

    return { times: sortedTimes, rows: valueMap };
  }, [stations]);

  return (
    <div className="rain-hourly-table-overlay" onClick={onClose}>
      <div className="rain-hourly-table-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rain-hourly-table-header">
          <h3>🌧️ Mưa theo giờ — 72 giờ qua (mm)</h3>
          <button className="rain-hourly-table-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="rain-hourly-table-legend">
          <span><span className="dot" style={{ background: '#1565C0' }} />0–25mm</span>
          <span><span className="dot" style={{ background: '#2E7D32' }} />&gt;25–50mm</span>
          <span><span className="dot" style={{ background: '#F9A825' }} />&gt;50–100mm</span>
          <span><span className="dot" style={{ background: '#D32F2F' }} />&gt;100mm</span>
        </div>
        <div className="rain-hourly-table-scroll">
          <table className="rain-hourly-table">
            <thead>
              <tr>
                <th className="rain-hourly-table-time-col">Thời gian</th>
                {stations.map((s) => (
                  <th key={s.id} style={s.id.startsWith('vrain_') ? { fontStyle: 'italic' } : undefined}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t) => (
                <tr key={t}>
                  <td className="rain-hourly-table-time-col">{formatTime(t)}</td>
                  {stations.map((s) => {
                    const v = rows[`${t}|${s.id}`];
                    const { bg, fg } = rainColor(v);
                    return (
                      <td key={s.id} style={{ background: bg, color: fg }}>
                        {v == null ? '—' : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
