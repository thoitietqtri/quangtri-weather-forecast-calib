import { useMemo } from 'react';
import './MucNuocTable.css';

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
// Bảng dạng hàng=giờ (thời gian), cột=trạm — giống bảng Python cũ
// (mucnuoc_wide.xlsx), nền navy cho khung/tiêu đề, có thanh trượt ngang+dọc.
export default function MucNuocTable({ stations, onClose }) {
  const { times, rows } = useMemo(() => {
    const timeSet = new Set();
    for (const s of stations) for (const p of s.series) timeSet.add(p.t);
    const sortedTimes = [...timeSet].sort((a, b) => b - a); // mới nhất lên đầu

    const valueMap = {}; // `${t}|${stationId}` -> value
    for (const s of stations) for (const p of s.series) valueMap[`${p.t}|${s.id}`] = p.v;

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
        </div>
        <div className="mucnuoc-table-scroll">
          <table className="mucnuoc-table">
            <thead>
              <tr>
                <th className="mucnuoc-table-time-col">Thời gian</th>
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
                  <td className="mucnuoc-table-time-col">{formatTime(t)}</td>
                  {stations.map((s) => {
                    const v = rows[`${t}|${s.id}`];
                    const { bg, fg } = alertColor(v, s.alertInfo);
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
