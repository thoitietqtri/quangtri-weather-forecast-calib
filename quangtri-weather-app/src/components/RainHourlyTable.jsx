import { useMemo } from 'react';
import './RainHourlyTable.css';
import { layLuuVuc } from './luuVucSong';

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
// Bảng dạng hàng=TRẠM, cột=GIỜ — giống đúng bố cục bảng "Mưa thực đo theo
// thời đoạn" đã có (trạm cố định bên trái, cuộn ngang xem các mốc giờ).
export default function RainHourlyTable({ stations, onClose }) {
  const sorted = useMemo(() => [...stations].sort((a, b) => layLuuVuc(a.name).thuTu - layLuuVuc(b.name).thuTu), [stations]);
  const { times, rows } = useMemo(() => {
    const timeSet = new Set();
    for (const s of stations) for (const p of s.series) timeSet.add(p.t);
    const sortedTimes = [...timeSet].sort((a, b) => b - a); // mới nhất bên trái

    const valueMap = {};
    for (const s of stations) for (const p of s.series) valueMap[`${s.id}|${p.t}`] = p.v;

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
          <span style={{ fontStyle: 'italic' }}>Tên nghiêng = trạm VRain</span>
          <span><span style={{ color: 'red' }}>*</span> = trạm KTTV</span>
        </div>
        <div className="rain-hourly-table-scroll">
          <table className="rain-hourly-table">
            <thead>
              <tr>
                <th className="rain-hourly-table-station-col">Lưu vực sông</th>
                <th className="rain-hourly-table-station-col">Trạm</th>
                {times.map((t) => <th key={t}>{formatTime(t)}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td className="rain-hourly-table-station-col">{layLuuVuc(s.name).luuVuc}</td>
                  <td className="rain-hourly-table-station-col" style={s.id.startsWith('vrain_') ? { fontStyle: 'italic' } : undefined}>
                    {s.name}{!s.id.startsWith('vrain_') && <span style={{ color: 'red' }}> *</span>}
                  </td>
                  {times.map((t) => {
                    const v = rows[`${s.id}|${t}`];
                    const { bg, fg } = rainColor(v);
                    return (
                      <td key={t} style={{ background: bg, color: fg }}>
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
