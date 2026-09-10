import { useMemo } from 'react';
import './MucNuocTable.css';

function formatTime(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// stations: [{ id, name, series: [{t, v}, ...] }, ...]
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
                    return <td key={s.id}>{v == null ? '—' : v}</td>;
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
