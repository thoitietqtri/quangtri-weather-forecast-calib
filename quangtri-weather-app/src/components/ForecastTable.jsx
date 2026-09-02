import { useEffect, useState } from 'react';
import './ForecastTable.css';

const TABS = [
  { key: 'rain', label: '🌧️ Mưa (mm)' },
  { key: 'accum', label: '💧 Mưa tích lũy (mm)' },
  { key: 'tmax', label: '🌡️ Tmax (°C)' },
  { key: 'tmin', label: '❄️ Tmin (°C)' },
  { key: 'wind', label: '💨 Gió (m/s)' },
];

const ACCUM_DAYS = [1, 2, 3, 4, 5]; // số ngày tích luỹ

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
  if (c < 15) return { bg: '#9C27B0', fg: '#fff' };
  if (c <= 20) return { bg: '#1565C0', fg: '#fff' };
  if (c <= 30) return { bg: '#2E7D32', fg: '#fff' };
  if (c < 35) return { bg: '#F9A825', fg: '#000' };
  return { bg: '#D32F2F', fg: '#fff' };
}
function windColor(ms) {
  if (ms == null) return { bg: '#f0f0f0', fg: '#999' };
  if (ms < 6) return { bg: '#2E7D32', fg: '#fff' };
  if (ms < 11) return { bg: '#F9A825', fg: '#000' };
  if (ms < 17) return { bg: '#EF6C00', fg: '#fff' };
  return { bg: '#D32F2F', fg: '#fff' };
}
const COLOR_FN = { rain: rainColor, accum: rainColor, tmax: tempColor, tmin: tempColor, wind: windColor };
const LEGEND = {
  rain: [['#1565C0', '0-25mm'], ['#2E7D32', '>25-50mm'], ['#F9A825', '>50-100mm'], ['#D32F2F', '>100mm']],
  accum: [['#1565C0', '0-25mm'], ['#2E7D32', '>25-50mm'], ['#F9A825', '>50-100mm'], ['#D32F2F', '>100mm']],
  tmax: [['#9C27B0', '<15°C'], ['#1565C0', '15-20°C'], ['#2E7D32', '>20-30°C'], ['#F9A825', '30-35°C'], ['#D32F2F', '>35°C']],
  tmin: [['#9C27B0', '<15°C'], ['#1565C0', '15-20°C'], ['#2E7D32', '>20-30°C'], ['#F9A825', '30-35°C'], ['#D32F2F', '>35°C']],
  wind: [['#2E7D32', '<6m/s'], ['#F9A825', '6-11m/s'], ['#EF6C00', '11-17m/s'], ['#D32F2F', '>17m/s']],
};

// Tính mưa tích luỹ từ ngày đầu tiên (hôm nay) đến hết ngày thứ n.
function cumulativeRain(rainArr, n) {
  const slice = rainArr.slice(0, n);
  if (slice.some((v) => v == null)) return null;
  return Math.round(slice.reduce((s, v) => s + v, 0) * 10) / 10;
}

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
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    setRows(null);
    const lats = xaList.map((x) => x.lat).join(',');
    const lngs = xaList.map((x) => x.lng).join(',');
    const url = `${forecastApiUrl}?latitude=${lats}&longitude=${lngs}`
      + `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,windspeed_10m_max&forecast_days=10&timezone=auto&models=ecmwf_ifs&wind_speed_unit=ms`;

    fetch(url)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) {
          const reason = body?.reason || body?.error?.message || `HTTP ${r.status}`;
          throw new Error(reason);
        }
        return body;
      })
      .then((data) => {
        const arr = Array.isArray(data) ? data : [data];
        if (arr.length !== xaList.length) {
          throw new Error(`Máy chủ dự báo đang quá tải (nhận ${arr.length}/${xaList.length} xã) — vui lòng thử lại`);
        }
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
  }, [xaList, forecastApiUrl, reloadKey]);

  return (
    <div className="forecast-table-overlay" onClick={onClose}>
      <div className="forecast-table-panel" onClick={(e) => e.stopPropagation()}>
        <div className="forecast-table-header">
          <h3>📅 Dự báo 10 ngày cho các xã/phường</h3>
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

        {error && (
          <div className="forecast-table-error">
            ⚠️ Không tải được dữ liệu: {error}<br />
            <button onClick={() => setReloadKey((k) => k + 1)} style={{ marginTop: 8 }}>🔁 Thử lại</button>
          </div>
        )}
        {!error && !rows && <div className="forecast-table-loading">⏳ Đang tải...</div>}

        {rows && (
          <div className="forecast-table-scroll">
            <table className="forecast-table">
              <thead>
                <tr>
                  <th className="forecast-table-station-col">Xã/Phường</th>
                  {tab === 'accum'
                    ? ACCUM_DAYS.map((n) => <th key={n}>{n} ngày</th>)
                    : dates.map((d) => <th key={d}>{formatDateLabel(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td className="forecast-table-station-col">{row.name}</td>
                    {tab === 'accum'
                      ? ACCUM_DAYS.map((n) => {
                          const v = cumulativeRain(row.rain, n);
                          const { bg, fg } = rainColor(v);
                          return (
                            <td key={n} style={{ background: bg, color: fg }}>
                              {v == null ? '—' : v}
                            </td>
                          );
                        })
                      : dates.map((_, i) => {
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
