import { useMemo } from 'react';
import './MucNuocTable.css'; // dùng chung khung/bảng với "Mực nước thực đo theo giờ"
import './ThapBaoLuTable.css';

const SO_GIO = 72; // số cột giờ tối đa (72 giờ qua)
const NGAP_MIN = 0.1; // từ ngưỡng này trở lên coi là có ngập (khớp màu chấm trên bản đồ)

function formatTime(t) {
  const d = new Date(t + 7 * 3600 * 1000); // dịch sang giờ VN trước khi đọc, tránh hiện giờ UTC
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Tháp báo lũ chưa có ngưỡng chính thức — chỉ 2 mức: chưa ngập / có ngập.
function mauO(value) {
  if (value == null) return { bg: '#9E9E9E', fg: '#fff' };
  return value >= NGAP_MIN ? { bg: '#D32F2F', fg: '#fff' } : { bg: '#607D8B', fg: '#fff' };
}

// stations: [{ id, name, coords:{lat,lng}, series:[{t, v}] }] — từ /mucnuoc?loai=thap.
// Bảng hàng = THÁP (theo thứ tự trong danh sách tháp), cột = GIỜ TRÒN (mới nhất bên trái), độ sâu ngập (m).
export default function ThapBaoLuTable({ stations, onClose }) {
  const { times, valueMap } = useMemo(() => {
    const GIO_MS = 3600 * 1000;
    const timeSet = new Set();
    const map = {}; // `${id}|${t}` -> value
    for (const s of stations) {
      for (const p of s.series) {
        if (p.t % GIO_MS !== 0) continue; // chỉ lấy giờ tròn (xx:00)
        timeSet.add(p.t);
        map[`${s.id}|${p.t}`] = p.v;
      }
    }
    const ts = [...timeSet].sort((a, b) => b - a).slice(0, SO_GIO); // mới nhất bên trái
    return { times: ts, valueMap: map };
  }, [stations]);

  return (
    <div className="mucnuoc-table-overlay" onClick={onClose}>
      <div className="mucnuoc-table-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mucnuoc-table-header">
          <h3>🗼 Mực nước Tháp báo lũ – độ sâu ngập 72 giờ qua (m)</h3>
          <button className="mucnuoc-table-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="mucnuoc-table-legend">
          <span><span className="dot" style={{ background: '#607D8B' }} />Chưa ngập (dưới {NGAP_MIN} m)</span>
          <span><span className="dot" style={{ background: '#D32F2F' }} />Có ngập (từ {NGAP_MIN} m)</span>
          <span><span className="dot" style={{ background: '#9E9E9E' }} />Chưa có số liệu</span>
        </div>
        {times.length === 0 ? (
          <div className="thap-table-note">Chưa có số liệu tháp báo lũ.</div>
        ) : (
          <div className="mucnuoc-table-scroll">
            <table className="mucnuoc-table">
              <thead>
                <tr>
                  <th className="mucnuoc-table-time-col">Tháp</th>
                  {times.map((t) => <th key={t}>{formatTime(t)}</th>)}
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id}>
                    <td className="mucnuoc-table-time-col" title={s.fullName || s.name}>{s.name}</td>
                    {times.map((t) => {
                      const v = valueMap[`${s.id}|${t}`];
                      const { bg, fg } = mauO(v);
                      return <td key={t} style={{ background: bg, color: fg }}>{v == null ? '—' : v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="thap-table-note">
          Độ sâu ngập đo tại tháp (không phải cao trình mực nước). Chỉ hiện các tháp đã có số liệu. Tham khảo – không thay thế bản tin chính thức của Đài KTTV tỉnh Quảng Trị.
        </div>
      </div>
    </div>
  );
}

