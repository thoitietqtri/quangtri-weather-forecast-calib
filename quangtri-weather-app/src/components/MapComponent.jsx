import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Popup, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './MapComponent.css';
import WeatherChart from './WeatherChart';
import { getRainStations } from '../services/rainfall';
import RainTable from './RainTable';
import ForecastTable from './ForecastTable';
import MucNuocTable from './MucNuocTable';
import MucNuocChart from './MucNuocChart';
import VisitCounter from './VisitCounter';
import InstallButton from './InstallButton';

function getCanhBao(tmax, tmin, wind, rain) {
  const warnings = [];
  if (tmax >= 38) warnings.push({ text: '🔥 Cảnh báo nắng nóng gay gắt', color: '#cc0000' });
  else if (tmax >= 35) warnings.push({ text: '☀️ Cảnh báo nắng nóng', color: '#ff6600' });
  if (tmin < 13) warnings.push({ text: '🥶 Cảnh báo rét hại', color: '#0000cc' });
  else if (tmin < 15) warnings.push({ text: '❄️ Cảnh báo rét đậm', color: '#3399ff' });
  if (wind > 16) warnings.push({ text: '🌊 Cảnh báo gió mạnh, sóng lớn trên biển', color: '#6600cc' });
  if (rain > 200) warnings.push({ text: '🌊 Cảnh báo sạt lở đất, ngập lụt vùng trũng thấp và hạ du các sông', color: '#cc0066' });
  else if (rain > 100) warnings.push({ text: '⚠️ Cảnh báo sạt lở đất', color: '#cc6600' });
  return warnings;
}

function createLabelIcon(name) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:10px;font-weight:bold;color:#000;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;white-space:nowrap;pointer-events:none;text-align:center;">${name}</div>`,
    iconAnchor: [0, 0],
  });
}

function createIslandIcon(name) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:13px;font-weight:bold;color:#cc0000;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;white-space:nowrap;pointer-events:none;text-align:center;background:rgba(255,255,255,0.7);padding:3px 6px;border-radius:4px;border:1.5px solid #cc0000;">🇻🇳 ${name}</div>`,
    iconAnchor: [60, 10],
  });
}

// Icon marker trạm đo mưa real-time — giọt nước xanh + nhãn tên trạm (đồng
// bộ hình ảnh với dự án satloluquetkhesanh).
// Phân cấp màu theo tổng mưa 24h — trả về { color, blink }.
//   = 0mm            → xám
//   >0  – <25mm       → xanh nước biển
//   25 – 50mm         → xanh lá
//   >50 – <100mm      → cam
//   >=100mm           → đỏ + nhấp nháy
function rainLevel(mm24h) {
  const v = Number(mm24h) || 0;
  if (v <= 0) return { color: '#9E9E9E', blink: false };
  if (v < 25) return { color: '#1565C0', blink: false };
  if (v <= 50) return { color: '#2E7D32', blink: false };
  if (v < 100) return { color: '#EF6C00', blink: false };
  return { color: '#D32F2F', blink: true };
}

function rainIcon(name, mm24h) {
  const { color, blink } = rainLevel(mm24h);
  const circleClass = `rain-marker__circle${blink ? ' rain-marker__circle--blink' : ''}`;
  return L.divIcon({
    className: 'rain-marker',
    html: `<div class="rain-marker__wrap">
      <span class="${circleClass}" style="background:${color}"><svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M12 2C12 2 5 11 5 15.5A7 7 0 0 0 19 15.5C19 11 12 2 12 2Z"/></svg></span>
      <span class="rain-marker__label" style="background:${color}">${name}</span>
    </div>`,
    iconSize: [110, 48],
    iconAnchor: [55, 15],
  });
}

// Trạm mưa cập nhật lại sau mỗi khoảng thời gian này (mili-giây).
const RAIN_REFRESH_MS = 10 * 60 * 1000;

// ============ Icon marker trạm mực nước ============
// Tự tính "hiện tại" (điểm cuối chuỗi) + "mức thay đổi 24h" từ chính chuỗi
// thời gian trả về — không có ngưỡng "báo động" cố định như mưa, nên dùng
// XU HƯỚNG biến động (tăng nhanh/chậm) làm tín hiệu màu:
//   giảm/không đổi   → xanh dương (ổn định)
//   tăng 0 - 0.5m     → xanh lá
//   tăng 0.5 - 1m     → vàng
//   tăng > 1m          → đỏ
function mucNuocSummary(series) {
  if (!series || series.length === 0) return { current: null, change24h: null };
  const sorted = [...series].sort((a, b) => a.t - b.t);
  const current = sorted[sorted.length - 1].v;
  const nowT = sorted[sorted.length - 1].t;
  const target = nowT - 24 * 3600 * 1000;
  let best = null; let bestDiff = Infinity;
  for (const p of sorted) {
    const diff = Math.abs(p.t - target);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  const change24h = best && bestDiff <= 40 * 60 * 1000 ? Math.round((current - best.v) * 100) / 100 : null;
  return { current, change24h };
}

// Tô màu mực nước theo cấp báo động — khác hẳn cách tô mưa (mưa dùng chung
// 1 ngưỡng cho mọi trạm; mực nước phụ thuộc cao độ nền địa hình từng sông
// nên PHẢI so với đúng ngưỡng riêng của từng trạm):
//   - Trạm có cấp báo động chính thức (BĐI/II/III): 4 mức — dưới BĐI (an
//     toàn) / BĐI-BĐII (cấp 1) / BĐII-BĐIII (cấp 2) / từ BĐIII (cấp 3, cao
//     nhất).
//   - Trạm chỉ có ngưỡng tự quy định (bình thường/cảnh báo/nguy hiểm): 3 mức.
//   - Trạm không phân cấp (hồ chứa, chưa có ngưỡng nào) -> màu xám trung
//     tính, không suy diễn mức nguy hiểm khi chưa có căn cứ.
function mucNuocColor(current, alertInfo) {
  if (current == null) return '#9E9E9E';
  if (!alertInfo) return '#9E9E9E'; // không phân cấp — giữ trung tính, không đoán mò
  if (alertInfo.type === 'official') {
    const { bd1, bd2, bd3 } = alertInfo;
    if (current >= bd3) return '#D32F2F'; // cấp III — đỏ
    if (current >= bd2) return '#EF6C00'; // cấp II — cam
    if (current >= bd1) return '#F9A825'; // cấp I — vàng
    return '#1565C0'; // dưới cấp I — an toàn
  }
  // type === 'custom'
  const { binhThuongMax, nguyHiemMin } = alertInfo;
  if (current >= nguyHiemMin) return '#D32F2F'; // nguy hiểm — đỏ
  if (current >= binhThuongMax) return '#EF6C00'; // cảnh báo — cam
  return '#1565C0'; // bình thường
}

function mucNuocIcon(name, current, alertInfo) {
  const color = mucNuocColor(current, alertInfo);
  return L.divIcon({
    className: 'mucnuoc-marker',
    html: `<div class="mucnuoc-marker__wrap">
      <span class="mucnuoc-marker__circle" style="background:${color}"><span style="color:#D32F2F;font-weight:900;font-size:15px;line-height:1;font-family:Arial,sans-serif;">H</span></span>
      <span class="mucnuoc-marker__label" style="background:${color}">${name}${current != null ? ` (${current}m)` : ''}</span>
    </div>`,
    iconSize: [130, 48],
    iconAnchor: [65, 15],
  });
}

// Trạm mực nước cập nhật lại sau mỗi khoảng thời gian này (mili-giây).
const MUCNUOC_REFRESH_MS = 15 * 60 * 1000;

// Mô tả cấp báo động bằng chữ cho popup — không chỉ dựa vào màu icon.
function mucNuocAlertText(current, alertInfo) {
  if (!alertInfo) return '⚪ Trạm hồ chứa — chưa phân cấp báo động';
  if (current == null) return '';
  if (alertInfo.type === 'official') {
    const { bd1, bd2, bd3 } = alertInfo;
    if (current >= bd3) return `🔴 Trên báo động III (${bd3}m)`;
    if (current >= bd2) return `🟠 Trên báo động II (${bd2}m)`;
    if (current >= bd1) return `🟡 Trên báo động I (${bd1}m)`;
    return `🔵 Dưới báo động I (${bd1}m)`;
  }
  const { binhThuongMax, nguyHiemMin } = alertInfo;
  if (current >= nguyHiemMin) return `🔴 Mức nguy hiểm (≥${nguyHiemMin}m)`;
  if (current >= binhThuongMax) return `🟠 Mức cảnh báo (${binhThuongMax}-${nguyHiemMin}m)`;
  return `🔵 Mức bình thường (<${binhThuongMax}m)`;
}

function MapComponent() {
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [weatherError, setWeatherError] = useState(null);
  const [weatherById, setWeatherById] = useState({});
  const [selectedDate, setSelectedDate] = useState('');
  const selectedDateRef = useRef('');
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  const [geoData, setGeoData] = useState(null);
  const [riverGeoData, setRiverGeoData] = useState(null);
  const [showRiver, setShowRiver] = useState(true);
  const [featureList, setFeatureList] = useState([]);
  const [selectedName, setSelectedName] = useState('');
  const [rainStations, setRainStations] = useState([]);
  const [showRain, setShowRain] = useState(true);
  const [showRainTable, setShowRainTable] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showForecastTable, setShowForecastTable] = useState(false);
  const [mucNuocStations, setMucNuocStations] = useState([]);
  const [showMucNuoc, setShowMucNuoc] = useState(true);
  const [showMucNuocTable, setShowMucNuocTable] = useState(false);
  const [showMucNuocChart, setShowMucNuocChart] = useState(false);
  const mapRef = useRef(null);

  // Đăng ký Service Worker (chỉ cache giao diện tĩnh, không đụng dữ liệu —
  // xem chi tiết trong file sw.js).
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.error('[SW] Đăng ký thất bại:', err));
    }
  }, []);

  // Tải lớp mạng lưới sông — độc lập, không chặn việc tải ranh giới xã.
  useEffect(() => {
    fetch('/mangsong.geojson')
      .then((r) => r.json())
      .then((data) => setRiverGeoData(data))
      .catch((err) => console.error('[Sông] Lỗi tải mạng lưới sông:', err));
  }, []);

  useEffect(() => {
    fetch('/PX_QUANGTRI.geojson')
      .then(r => r.json())
      .then(data => {
        setGeoData(data);
        const list = data.features.map(f => ({
          name: f.properties.ten || f.properties.Ten || f.properties.name || '',
          feature: f
        })).filter(f => f.name).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        setFeatureList(list);
        fetchAllWeather(data);
      });
  }, []);

  // Trạm mưa real-time: tải lần đầu rồi tự làm mới định kỳ.
  useEffect(() => {
    let cancelled = false;
    const loadRain = () => {
      getRainStations()
        .then((stations) => { if (!cancelled) setRainStations(stations); })
        .catch((err) => console.error('[Mưa] Lỗi tải trạm:', err));
    };
    loadRain();
    const timer = setInterval(loadRain, RAIN_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Trạm mực nước real-time: tải lần đầu rồi tự làm mới định kỳ.
  useEffect(() => {
    let cancelled = false;
    const loadMucNuoc = () => {
      fetch('/.netlify/functions/mucnuoc')
        .then((r) => r.json())
        .then((stations) => { if (!cancelled && Array.isArray(stations)) setMucNuocStations(stations); })
        .catch((err) => console.error('[Mực nước] Lỗi tải trạm:', err));
    };
    loadMucNuoc();
    const timer = setInterval(loadMucNuoc, MUCNUOC_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const fetchAllWeather = async (data) => {
    const results = {};
    for (const feature of data.features) {
      const name = feature.properties.ten || feature.properties.Ten || feature.properties.name || '';
      const layer = L.geoJSON(feature);
      const center = layer.getBounds().getCenter();
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&daily=temperature_2m_max&timezone=auto&models=ecmwf_ifs`);
        const d = await res.json();
        results[name] = d.daily?.temperature_2m_max?.[0] || null;
      } catch { results[name] = null; }
    }
    setWeatherById(results);
  };

  const getColorByTemperature = (temp) => {
    if (temp == null) return '#ccc';
    if (temp > 37) return '#ff0000';
    if (temp > 33) return '#ff8000';
    if (temp > 28) return '#ffff00';
    if (temp > 22) return '#80ff00';
    return '#00ffff';
  };

  const geoJsonStyle = (feature) => {
    const name = feature.properties.ten || feature.properties.Ten || feature.properties.name || '';
    return { color: '#333', weight: 1.5, fillColor: getColorByTemperature(weatherById[name]), fillOpacity: 0.65 };
  };

  // ECMWF IFS chỉ trả dự báo tối đa 15 ngày (hôm nay + 14 ngày tiếp theo),
  // nhưng đúng ngày biên cuối cùng (index 14) đôi khi CHƯA có đủ dữ liệu tại
  // thời điểm gọi (rìa giới hạn mô hình) -> chừa thêm 1 ngày đệm an toàn,
  // chỉ cho chọn tối đa +13 ngày để luôn chắc chắn có dữ liệu.
  const maxSelectableDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 13);
    return d.toISOString().slice(0, 10);
  })();

  const fetchWeather = async (center, dateOverride) => {
    const dateToUse = dateOverride !== undefined ? dateOverride : selectedDateRef.current;
    let url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&hourly=temperature_2m,precipitation,windspeed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=auto&models=ecmwf_ifs`;
    if (dateToUse) url += `&start_date=${dateToUse}&end_date=${dateToUse}`;
    setWeatherError(null);
    setWeatherData(null); // xoá dữ liệu cũ, hiện lại "Đang tải..." khi bắt đầu tải mới
    try {
      // Giới hạn thời gian chờ 12 giây — nếu quá lâu (mạng chậm/server treo),
      // chủ động báo lỗi rõ ràng thay vì treo mãi "Đang tải...".
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      let res;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`Máy chủ trả lỗi HTTP ${res.status}`);
      setWeatherData(await res.json());
    } catch (err) {
      console.error(err);
      setWeatherError(err.name === 'AbortError' ? 'Quá thời gian chờ, vui lòng thử lại.' : 'Không tải được dữ liệu, vui lòng thử lại.');
    }
  };

  const selectFeatureByName = async (name) => {
    const found = featureList.find(f => f.name === name);
    if (!found) return;
    const layer = L.geoJSON(found.feature);
    const center = layer.getBounds().getCenter();
    setSelectedFeature({ center, name });
    setWeatherData(null);
    await fetchWeather(center);
    if (mapRef.current) mapRef.current.setView([center.lat, center.lng], 11);
  };

  const handleFeatureClick = async (e) => {
    const feature = e.target.feature;
    const center = e.target.getBounds().getCenter();
    const name = feature.properties.ten || feature.properties.Ten || feature.properties.name || 'Không rõ';
    setSelectedName(name);
    setSelectedFeature({ center, name });
    setWeatherData(null);
    await fetchWeather(center);
  };

  const onEachFeature = (feature, layer) => {
    layer.on({ click: handleFeatureClick });
  };

  const renderPopup = () => {
    if (!selectedFeature) return null;
    if (weatherError) return (
      <Popup position={selectedFeature.center}>
        <div style={{ padding: '10px', color: '#c62828' }}>
          ⚠️ {weatherError}<br />
          <button onClick={() => fetchWeather(selectedFeature.center)} style={{ marginTop: 6 }}>Thử lại</button>
        </div>
      </Popup>
    );
    if (!weatherData?.daily) return (
      <Popup position={selectedFeature.center}>
        <div style={{ padding: '10px' }}>⏳ Đang tải...</div>
      </Popup>
    );
    const { center, name } = selectedFeature;
    const daily = weatherData.daily;
    const tmax = daily.temperature_2m_max[0];
    const tmin = daily.temperature_2m_min[0];
    const rain = daily.precipitation_sum[0];
    const windMs = parseFloat((daily.windspeed_10m_max[0] / 3.6).toFixed(1));
    const warnings = getCanhBao(tmax, tmin, windMs, rain);
    return (
      <Popup position={center}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', lineHeight: '1.7', color: '#333', border: '3px solid #2196f3', borderRadius: '8px', padding: '10px', background: '#f5f5f5', minWidth: '200px' }}>
          <div style={{ fontSize: '16px', color: '#2196f3', marginBottom: '4px' }}>{name}</div>
          <div style={{ fontSize: '13px', marginBottom: '8px', fontWeight: 'normal' }}>Ngày dự báo: {selectedDate || 'Hôm nay'}</div>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Trị số dự báo:</div>
          <div>🌡️ Tmax: {tmax}°C</div>
          <div>🌡️ Tmin: {tmin}°C</div>
          <div>☔ Mưa: {rain} mm</div>
          <div>💨 Gió Max: {windMs} m/s</div>
          {warnings.length > 0 ? (
            <div style={{ marginTop: '10px', padding: '8px', background: '#fff3cd', borderRadius: '6px', border: '1px solid #ffc107' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ Cảnh báo thiên tai:</div>
              {warnings.map((w, i) => <div key={i} style={{ color: w.color, fontWeight: 'bold', fontSize: '13px' }}>{w.text}</div>)}
            </div>
          ) : (
            <div style={{ marginTop: '10px', padding: '6px 8px', background: '#d4edda', borderRadius: '6px', border: '1px solid #28a745', color: '#155724', fontSize: '13px', fontWeight: 'bold' }}>
              ✅ Không có cảnh báo thiên tai
            </div>
          )}
        </div>
      </Popup>
    );
  };

  const renderLabels = () => {
    if (!geoData) return null;
    return geoData.features.map((feature, i) => {
      const name = feature.properties.ten || feature.properties.Ten || feature.properties.name || '';
      if (!name) return null;
      const center = L.geoJSON(feature).getBounds().getCenter();
      return <Marker key={i} position={[center.lat, center.lng]} icon={createLabelIcon(name)} interactive={false} />;
    });
  };

  return (
    <div className="app-wrapper">
      <VisitCounter />
      <h2 className="app-title">
        <button onClick={() => setShowMenu(true)} className="hamburger-btn" aria-label="Mở menu chức năng">☰</button>
        <span className="app-title__icon" aria-hidden="true">⛅</span>
        THỜI TIẾT QUẢNG TRỊ
        <span className="app-title__icon" aria-hidden="true">⛅</span>
      </h2>

      <div className="toolbar">
        <div className="toolbar-row-xa-ngay">
          <label>📍 <span className="toolbar-label-text">Chọn xã/phường:</span></label>
          <select value={selectedName} onChange={(e) => { setSelectedName(e.target.value); selectFeatureByName(e.target.value); }}>
            <option value="">-- Chọn địa danh --</option>
            {featureList.map((f, i) => <option key={i} value={f.name}>{f.name}</option>)}
          </select>
          <label>📅 <span className="toolbar-label-text">Ngày:</span></label>
          <input
            type="date"
            value={selectedDate}
            max={maxSelectableDate}
            onChange={(e) => {
              let newDate = e.target.value;
              // Chặn cứng phía JS — một số trình duyệt di động (Android/Chrome)
              // không tự làm mờ ngày vượt "max" trên giao diện lịch gốc, nên
              // không thể chỉ dựa vào thuộc tính max của thẻ input.
              if (newDate > maxSelectableDate) newDate = maxSelectableDate;
              setSelectedDate(newDate);
              if (selectedFeature) fetchWeather(selectedFeature.center, newDate);
            }}
          />
        </div>
        <div className="toolbar-row-checkboxes">
          <label className="toolbar-rain-toggle">
            <input type="checkbox" checked={showRain} onChange={(e) => setShowRain(e.target.checked)} />
            💧 Trạm mưa
          </label>
          <label className="toolbar-rain-toggle">
            <input type="checkbox" checked={showMucNuoc} onChange={(e) => setShowMucNuoc(e.target.checked)} />
            🌊 Trạm mực nước
          </label>
          <label className="toolbar-rain-toggle">
            <input type="checkbox" checked={showRiver} onChange={(e) => setShowRiver(e.target.checked)} />
            🏞️ Mạng lưới sông
          </label>
        </div>
        <InstallButton />
      </div>

      {showMenu && (
        <div className="hamburger-menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="hamburger-menu-panel" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setShowRainTable(true); setShowMenu(false); }}>🌧️ Mưa thực đo</button>
            <button onClick={() => { setShowMucNuocTable(true); setShowMenu(false); }}>📈 Mực nước thực đo</button>
            <button onClick={() => { setShowMucNuocChart(true); setShowMenu(false); }}>📉 Biểu đồ mực nước</button>
            <button onClick={() => { setShowForecastTable(true); setShowMenu(false); }}>📅 Dự báo thời tiết</button>
            
          </div>
        </div>
      )}

      {showRainTable && <RainTable stations={rainStations} onClose={() => setShowRainTable(false)} />}
      {showMucNuocTable && <MucNuocTable stations={mucNuocStations} onClose={() => setShowMucNuocTable(false)} />}
      {showMucNuocChart && <MucNuocChart stations={mucNuocStations} onClose={() => setShowMucNuocChart(false)} />}
      {showForecastTable && (
        <ForecastTable
          xaList={featureList.map((f) => {
            const layer = L.geoJSON(f.feature);
            const c = layer.getBounds().getCenter();
            return { ten_xa: f.name, lat: c.lat, lng: c.lng };
          })}
          forecastApiUrl="https://api.open-meteo.com/v1/forecast"
          onClose={() => setShowForecastTable(false)}
        />
      )}

      {showRain && (
        <div className="rain-legend">
          <span className="rain-legend__item"><span className="rain-legend__dot" style={{ background: '#9E9E9E' }} />0mm/24h</span>
          <span className="rain-legend__item"><span className="rain-legend__dot" style={{ background: '#1565C0' }} />&lt;25mm/24h</span>
          <span className="rain-legend__item"><span className="rain-legend__dot" style={{ background: '#2E7D32' }} />25-50mm/24h</span>
          <span className="rain-legend__item"><span className="rain-legend__dot" style={{ background: '#EF6C00' }} />50-100mm/24h</span>
          <span className="rain-legend__item"><span className="rain-legend__dot rain-legend__dot--blink" style={{ background: '#D32F2F' }} />&gt;100mm/24h</span>
        </div>
      )}

      {/* Bản đồ lấp đầy phần còn lại */}
      <div className="map-wrapper">
        {geoData ? (
          <MapContainer center={[16.75, 107.1]} zoom={8} className="responsive-map" ref={mapRef}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {showRiver && riverGeoData && (
              <GeoJSON
                data={riverGeoData}
                style={{ color: '#1565C0', weight: 1, fillColor: '#1565C0', fillOpacity: 0.55 }}
                onEachFeature={(feature, layer) => {
                  const ten = feature.properties?.TENSONG;
                  if (ten) layer.bindPopup(`<b>${ten}</b>`);
                }}
              />
            )}
            <GeoJSON data={geoData} onEachFeature={onEachFeature} style={geoJsonStyle} key={JSON.stringify(weatherById)} />
            {renderLabels()}
            <Marker position={[16.5, 112.0]} icon={createIslandIcon('Đặc khu Hoàng Sa - Việt Nam')} interactive={false} />
            <Marker position={[10.5, 114.5]} icon={createIslandIcon('Đặc khu Trường Sa - Việt Nam')} interactive={false} />
            {showRain && rainStations.map((s) => (
              <Marker key={s.id} position={[s.coords.lat, s.coords.lng]} icon={rainIcon(s.name, s.rain_24h)}>
                <Popup>
                  <b>{s.name}</b><br />
                  1h: {s.rain_1h ?? '—'}mm · 3h: {s.rain_3h ?? '—'}mm · 6h: {s.rain_6h ?? '—'}mm<br />
                  24h: {s.rain_24h ?? '—'}mm · 48h: {s.rain_48h ?? '—'}mm · 72h: {s.rain_72h ?? '—'}mm
                </Popup>
              </Marker>
            ))}
            {showMucNuoc && mucNuocStations.map((s) => {
              const { current, change24h } = mucNuocSummary(s.series);
              return (
                <Marker key={s.id} position={[s.coords.lat, s.coords.lng]} icon={mucNuocIcon(s.name, current, s.alertInfo)}>
                  <Popup>
                    <b>{s.name}</b><br />
                    Hiện tại: {current ?? '—'}m<br />
                    Thay đổi 24h: {change24h == null ? '—' : (change24h > 0 ? `+${change24h}` : change24h)}m<br />
                    {mucNuocAlertText(current, s.alertInfo)}
                  </Popup>
                </Marker>
              );
            })}
            {renderPopup()}
          </MapContainer>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            ⏳ Đang tải bản đồ...
          </div>
        )}
      </div>

      {/* Biểu đồ đặt DƯỚI bản đồ */}
      {weatherData?.hourly && (
        <div className="chart-wrapper">
          <WeatherChart hourly={weatherData.hourly} regionName={selectedFeature?.name || ''} />
        </div>
      )}
    </div>
  );
}

export default MapComponent;
