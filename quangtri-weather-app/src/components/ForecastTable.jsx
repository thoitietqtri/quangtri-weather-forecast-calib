import { useEffect, useState } from 'react';
import './ForecastTable.css';

const TABS = [
  { key: 'rain', label: '🌧️ Mưa (mm)' },
  { key: 'tmax', label: '🌡️ Tmax (°C)' },
  { key: 'tmin', label: '❄️ Tmin (°C)' },
  { key: 'wind', label: '💨 Gió (m/s)' },
];

// Ngưỡng màu — mưa dùng ĐÚNG thang đã thống nhất ở Bảng mưa chi tiết, nhiệt
// độ/gió dùng thang riêng phù hợp với khí hậu Quảng Trị.
function rainColor(mm) {
  if (mm == null) return { bg: '#f0f0f0', fg: '#999' };
  if (mm <= 25) return { bg: '#1565C0', fg: '#fff' };
  if (mm <= 50) return { bg: '#2E7D32', fg: '#fff' };
  if (mm <= 100) return { bg: '#F9A825', fg: '#000' };
  return { bg: '#D32F2F', fg: '#fff' };
}
function tempColor(c) {
  if (c == null) return { bg: '#f0f0f0', fg: '#999' };
  if (c < 20) return { bg: '#1565C0', fg: '#fff' };
  if (c < 27) return { bg: '#2E7D32', fg: '#fff' };
  if (c < 33) return { bg: '#F9A825', fg: '#000' };
  return { bg: '#D32F2F', fg: '#fff' };
}
function windColor(ms) {
  if (ms == null) return { bg: '#f0f0f0', fg: '#999' };
  if (ms < 6) return { bg: '#2E7D32', fg: '#fff' };
  if (ms < 11) return { bg: '#F9A825', fg: '#000' };
  if (ms < 17) return { bg: '#EF6C00', fg: '#fff' };
  return { bg: '#D32F2F', fg: '#fff' };
}
const COLOR_FN = { rain: rainColor, tmax: tempColor, tmin: tempColor, wind: windColor };
const LEGEND = {
  rain: [['#1565C0', '0-25mm'], ['#2E7D32', '>25-50mm'], ['#F9A825', '>50-100mm'], ['#D32F2F', '>100mm']],
  tmax: [['#1565C0', '<20°C'], ['#2E7D32', '20-27°C'], ['#F9A825', '27-33°C'], ['#D32F2F', '>33°C']],
  tmin: [['#1565C0', '<20°C'], ['#2E7D32', '20-27°C'], ['#F9A825', '27-33°C'], ['#D32F2F', '>33°C']],
  wind: [['#2E7D32', '<6m/s'], ['#F9A825', '6-11m/s'], ['#EF6C00', '11-17m/s'], ['#D32F2F', '>17m/s']],
};

function formatDateLabel(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// forecastApiUrl: cho phép mỗi dự án tự truyền đúng URL nền (production gọi
// thẳng Open-Meteo, calib gọi qua function forecast.mjs để có hiệu chỉnh).
export default function ForecastTable({ xaList, forecastApiUrl, onClose }) {
  const [tab, setTab] = useState('rain');
  const [rows, setRows] = useState(null);
  const [dates, setDates] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const lats = xaList.map((x) => x.lat).join(',');
    const lngs = xaList.map((x) => x.lng).join(',');
    const url = `${forecastApiUrl}?latitude=${lats}&longitude=${lngs}`
      + `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,windspeed_10m_max&forecast_days=10&timezone=auto&models=ecmwf_ifs&wind_speed_unit=ms`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [data];
        if (arr.length !== xaList.length) throw new Error('Số kết quả không khớp số xã');
        setDates(arr[0]?.daily?.time || []);
        setRows(xaList.map((xa, i) => ({
          name: xa.ten_xa || xa.name,
          rain: arr[i]?.daily?.precipitation_sum || [],
          tmax: arr[i]?.daily?.temperature_2m_max || [],
          tmin: arr[i]?.daily?.temperature_2m_min || [],
          wind: arr[i]?.daily?.windspeed_10m_max || [],
        })));
      })
      .catch((e) => setError(e.message));
  }, [xaList, forecastApiUrl]);

  return (
    <div className="forecast-table-overlay" onClick={onClose}>
      <div className="forecast-table-panel" onClick={(e) => e.stopPropagation()}>
        <div className="forecast-table-header">
          <h3>📅 Bảng số liệu Dự báo 10 ngày tới cho các xã/phường</h3>
          <button className="forecast-table-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="forecast-table-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`forecast-table-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="forecast-table-legend">
          {LEGEND[tab].map(([color, label]) => (
            <span key={label}><span className="dot" style={{ background: color }} />{label}</span>
          ))}
        </div>

        {error && <div className="forecast-table-error">⚠️ Không tải được dữ liệu: {error}</div>}
        {!error && !rows && <div className="forecast-table-loading">⏳ Đang tải...</div>}

        {rows && (
          <div className="forecast-table-scroll">
            <table className="forecast-table">
              <thead>
                <tr>
                  <th className="forecast-table-station-col">Xã/Phường</th>
                  {dates.map((d) => <th key={d}>{formatDateLabel(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td className="forecast-table-station-col">{row.name}</td>
                    {dates.map((_, i) => {
                      const v = row[tab][i];
                      const { bg, fg } = COLOR_FN[tab](v);
                      return (
                        <td key={i} style={{ background: bg, color: fg }}>
                          {v == null ? '—' : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
