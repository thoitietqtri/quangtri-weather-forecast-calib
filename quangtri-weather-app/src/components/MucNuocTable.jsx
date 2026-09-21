import { useMemo } from 'react';
import './MucNuocTable.css';
import { layLuuVuc } from './luuVucSong';

function formatTime(t) {
  const d = new Date(t + 7 * 3600 * 1000); // dịch sang giờ VN trước khi đọc, tránh hiện giờ UTC
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Tô màu từng ô theo ĐÚNG ngưỡng riêng của trạm đó (không phải 1 ngưỡng
// chung như mưa) — khớp đúng logic đã dùng cho icon bản đồ trong
// MapComponent.jsx (cố tình lặp lại ở đây thay vì import chung, theo đúng
// khuôn mẫu sẵn có của dự án — mỗi file tự chứa logic màu riêng của nó).
function alertColor(value, alertInfo) {
  if (value == null) return { bg: '#1565C0', fg: '#fff' };
  if (!alertInfo) return { bg: '#9E9E9E', fg: '#fff' }; // không phân cấp (hồ chứa)
  if (alertInfo.type === 'official') {
    const { bd1, bd2, bd3 } = alertInfo;
    if (value >= bd3) return { bg: '#D32F2F', fg: '#fff' };
    if (value >= bd2) return { bg: '#EF6C00', fg: '#fff' };
    if (value >= bd1) return { bg: '#F9A825', fg: '#000' };
    return { bg: '#1565C0', fg: '#fff' };
  }
  const { binhThuongMax, nguyHiemMin } = alertInfo;
  if (value >= nguyHiemMin) return { bg: '#D32F2F', fg: '#fff' };
  if (value >= binhThuongMax) return { bg: '#EF6C00', fg: '#fff' };
  return { bg: '#1565C0', fg: '#fff' };
}

// stations: [{ id, name, alertInfo, series: [{t, v}, ...] }, ...]
// Bảng dạng hàng=TRẠM, cột=GIỜ — giống đúng bố cục "Mưa thực đo theo thời
// đoạn" / "Mưa theo giờ" đã có, trạm cố định bên trái khi cuộn ngang.
export default function MucNuocTable({ stations, onClose }) {
  const sorted = useMemo(() => [...stations].sort((a, b) => layLuuVuc(a.id).thuTu - layLuuVuc(b.id).thuTu), [stations]);
  const { times, rows } = useMemo(() => {
    const timeSet = new Set();
    for (const s of stations) for (const p of s.series) timeSet.add(p.t);
    const sortedTimes = [...timeSet].sort((a, b) => b - a); // mới nhất bên trái

    const valueMap = {}; // `${stationId}|${t}` -> value
    for (const s of stations) for (const p of s.series) valueMap[`${s.id}|${p.t}`] = p.v;

    return { times: sortedTimes, rows: valueMap };
  }, [stations]);

  return (
    <div className="mucnuoc-table-overlay" onClick={onClose}>
      <div className="mucnuoc-table-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mucnuoc-table-header">
          <h3>🌊 Mực nước thực đo theo giờ (m)</h3>
          <button className="mucnuoc-table-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="mucnuoc-table-legend">
          <span><span className="dot" style={{ background: '#1565C0' }} />An toàn/bình thường</span>
          <span><span className="dot" style={{ background: '#F9A825' }} />Trên BĐ I</span>
          <span><span className="dot" style={{ background: '#EF6C00' }} />Trên BĐ II / cảnh báo</span>
          <span><span className="dot" style={{ background: '#D32F2F' }} />Trên BĐ III / nguy hiểm</span>
          <span><span className="dot" style={{ background: '#9E9E9E' }} />Chưa phân cấp (hồ chứa)</span>
          <span><span style={{ color: 'red' }}>*</span> = trạm KTTV</span>
        </div>
        <div className="mucnuoc-table-scroll">
          <table className="mucnuoc-table">
            <thead>
              <tr>
                <th className="mucnuoc-table-time-col">Lưu vực sông</th>
                <th className="mucnuoc-table-time-col">Trạm</th>
                {times.map((t) => <th key={t}>{formatTime(t)}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td className="mucnuoc-table-time-col">{layLuuVuc(s.id).luuVuc}</td>
                  <td className="mucnuoc-table-time-col" style={s.id.startsWith('vrain_') ? { fontStyle: 'italic' } : undefined}>
                    {s.name}{!s.id.startsWith('vrain_') && <span style={{ color: 'red' }}> *</span>}
                  </td>
                  {times.map((t) => {
                    const v = rows[`${s.id}|${t}`];
                    const { bg, fg } = alertColor(v, s.alertInfo);
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
