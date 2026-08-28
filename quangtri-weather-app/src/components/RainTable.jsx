import './RainTable.css';

// Ngưỡng màu theo lượng mưa (áp dụng riêng cho từng ô trong bảng — độc lập
// với thang màu marker trên bản đồ):
//   0 - 25mm   -> xanh nước biển
//   >25 - 50mm -> xanh lá
//   >50 - 100mm -> vàng
//   >100mm     -> đỏ
function cellColor(mm) {
  if (mm == null) return { bg: '#f0f0f0', fg: '#999' };
  if (mm <= 25) return { bg: '#1565C0', fg: '#fff' };
  if (mm <= 50) return { bg: '#2E7D32', fg: '#fff' };
  if (mm <= 100) return { bg: '#F9A825', fg: '#000' };
  return { bg: '#D32F2F', fg: '#fff' };
}

const WINDOWS = [
  { key: 'rain_1h', label: '1h' },
  { key: 'rain_3h', label: '3h' },
  { key: 'rain_6h', label: '6h' },
  { key: 'rain_12h', label: '12h' },
  { key: 'rain_24h', label: '24h' },
  { key: 'rain_48h', label: '48h' },
  { key: 'rain_72h', label: '72h' },
];

export default function RainTable({ stations, onClose }) {
  const sorted = [...stations].sort((a, b) => (b.rain_24h ?? 0) - (a.rain_24h ?? 0));

  return (
    <div className="rain-table-overlay" onClick={onClose}>
      <div className="rain-table-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rain-table-header">
          <h3>📊 Bảng lượng mưa các trạm (mm)</h3>
          <button className="rain-table-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="rain-table-legend">
          <span><span className="dot" style={{ background: '#1565C0' }} />0–25mm</span>
          <span><span className="dot" style={{ background: '#2E7D32' }} />&gt;25–50mm</span>
          <span><span className="dot" style={{ background: '#F9A825' }} />&gt;50–100mm</span>
          <span><span className="dot" style={{ background: '#D32F2F' }} />&gt;100mm</span>
        </div>
        <div className="rain-table-scroll">
          <table className="rain-table">
            <thead>
              <tr>
                <th className="rain-table-station-col">Trạm</th>
                {WINDOWS.map((w) => <th key={w.key}>{w.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td className="rain-table-station-col">{s.name}</td>
                  {WINDOWS.map((w) => {
                    const v = s[w.key];
                    const { bg, fg } = cellColor(v);
                    return (
                      <td key={w.key} style={{ background: bg, color: fg }}>
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
