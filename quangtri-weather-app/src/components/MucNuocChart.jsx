import { useMemo, useState } from 'react';
import { ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import './MucNuocChart.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function findValueAt(sortedSeries, targetT, toleranceMs = 40 * 60 * 1000) {
  let best = null; let bestDiff = Infinity;
  for (const p of sortedSeries) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= toleranceMs ? best.v : null;
}

function computeCuongSuat(sortedSeries, hours) {
  if (sortedSeries.length === 0) return null;
  const last = sortedSeries[sortedSeries.length - 1];
  const past = findValueAt(sortedSeries, last.t - hours * 3600 * 1000);
  if (past == null) return null;
  return Math.round(((last.v - past) / hours) * 1000) / 1000;
}

function trendText(cs) {
  if (cs == null) return '—';
  const sign = cs > 0 ? '+' : '';
  const arrow = cs > 0.02 ? '📈 Đang lên' : cs < -0.02 ? '📉 Đang xuống' : '➡️ Ổn định';
  return `${sign}${cs} m/h (${arrow})`;
}

// Khoảng cách 2 điểm toạ độ (km) — công thức Haversine chuẩn.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Tìm trạm mưa GẦN NHẤT với 1 trạm mực nước — dùng chung 1 thuật toán cho cả
// 2 trường hợp: trạm đo cả 2 yếu tố (khoảng cách ~0, gần như trùng vị trí)
// và trạm chỉ đo mực nước (khoảng cách xa hơn, chỉ là suy diễn gần đúng).
function findNearestRainStation(waterStation, rainStations) {
  if (!waterStation || rainStations.length === 0) return null;
  let best = null; let bestDist = Infinity;
  for (const r of rainStations) {
    const d = haversineKm(waterStation.coords.lat, waterStation.coords.lng, r.coords.lat, r.coords.lng);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return best ? { station: best, distanceKm: Math.round(bestDist * 10) / 10 } : null;
}

// Vạch ngưỡng ngang — 3 vạch (BĐI/II/III) cho trạm có cấp báo động chính
// thức, 2 vạch (bình thường/nguy hiểm) cho trạm dùng ngưỡng tự quy định,
// không có vạch nào cho trạm chưa phân cấp (hồ chứa). Dùng ĐÚNG màu đã
// thống nhất trong toàn app (icon bản đồ, bảng dữ liệu) để nhất quán.
function AlertReferenceLines({ alertInfo }) {
  if (!alertInfo) return null;
  if (alertInfo.type === 'official') {
    return (
      <>
        <ReferenceLine yAxisId="level" y={alertInfo.bd1} stroke="#F9A825" strokeDasharray="4 4" label={{ value: 'BĐ I', position: 'insideTopLeft', fill: '#F9A825', fontSize: 10 }} />
        <ReferenceLine yAxisId="level" y={alertInfo.bd2} stroke="#EF6C00" strokeDasharray="4 4" label={{ value: 'BĐ II', position: 'insideTopLeft', fill: '#EF6C00', fontSize: 10 }} />
        <ReferenceLine yAxisId="level" y={alertInfo.bd3} stroke="#D32F2F" strokeDasharray="4 4" label={{ value: 'BĐ III', position: 'insideTopLeft', fill: '#D32F2F', fontSize: 10 }} />
      </>
    );
  }
  return (
    <>
      <ReferenceLine yAxisId="level" y={alertInfo.binhThuongMax} stroke="#EF6C00" strokeDasharray="4 4" label={{ value: 'Cảnh báo', position: 'insideTopLeft', fill: '#EF6C00', fontSize: 10 }} />
      <ReferenceLine yAxisId="level" y={alertInfo.nguyHiemMin} stroke="#D32F2F" strokeDasharray="4 4" label={{ value: 'Nguy hiểm', position: 'insideTopLeft', fill: '#D32F2F', fontSize: 10 }} />
    </>
  );
}

// stations: trạm mực nước [{ id, name, alertInfo, series: [{t, v}] }, ...]
// rainStations: trạm mưa theo giờ (từ rainfall-hourly.js), cùng cấu trúc.
export default function MucNuocChart({ stations, rainStations = [], onClose }) {
  const [stationId, setStationId] = useState(stations[0]?.id || '');
  const station = stations.find((s) => s.id === stationId);

  const nearestRain = useMemo(
    () => findNearestRainStation(station, rainStations),
    [station, rainStations],
  );

  const sorted = useMemo(() => {
    if (!station) return [];
    return [...station.series].sort((a, b) => a.t - b.t);
  }, [station]);

  const rainSorted = useMemo(() => {
    if (!nearestRain) return [];
    return [...nearestRain.station.series].sort((a, b) => a.t - b.t);
  }, [nearestRain]);

  // Ghép 2 chuỗi (mực nước làm trục thời gian chính) thành 1 mảng duy nhất
  // cho ComposedChart — mỗi điểm có cả level lẫn rain (nếu tìm được mốc giờ
  // khớp trong phạm vi ±40 phút).
  const chartData = sorted.map((p) => ({
    time: formatTimeVN(p.t),
    level: p.v,
    rain: rainSorted.length > 0 ? findValueAt(rainSorted, p.t) : null,
  }));

  const maxRain = Math.max(1, ...chartData.map((d) => d.rain || 0));

  const cuongSuat1h = computeCuongSuat(sorted, 1);
  const cuongSuat3h = computeCuongSuat(sorted, 3);
  const cuongSuat6h = computeCuongSuat(sorted, 6);

  return (
    <div className="mucnuoc-chart-overlay" onClick={onClose}>
      <div className="mucnuoc-chart-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mucnuoc-chart-header">
          <h3>📉 Biểu đồ mực nước & mưa theo giờ</h3>
          <button className="mucnuoc-chart-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="mucnuoc-chart-controls">
          <label>Chọn trạm:</label>
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {nearestRain && (
          <div className="mucnuoc-chart-rain-note">
            🌧️ Mưa hiển thị từ trạm: <b>{nearestRain.station.name}</b>
            {nearestRain.distanceKm < 0.5
              ? ' (cùng vị trí)'
              : ` (cách ${nearestRain.distanceKm}km — trạm gần nhất, chỉ mang tính tham khảo)`}
          </div>
        )}

        <div className="mucnuoc-chart-body">
          {chartData.length === 0 ? (
            <div className="mucnuoc-chart-empty">⏳ Không có dữ liệu cho trạm này</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
                <XAxis dataKey="time" angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" tick={{ fontSize: 10, fill: '#fff' }} stroke="rgba(255,255,255,0.4)" />
                <YAxis yAxisId="level" tick={{ fontSize: 11, fill: '#fff' }} stroke="rgba(255,255,255,0.4)" label={{ value: 'Mực nước (m)', angle: -90, position: 'insideLeft', fill: '#fff' }} />
                {/* Trục mưa ĐẢO NGƯỢC (reversed) + domain kéo giãn gấp 4 lần giá
                    trị lớn nhất -> cột mưa chỉ chiếm khoảng 1/4 phía trên biểu
                    đồ, "treo" xuống từ đỉnh thay vì mọc từ đáy lên. */}
                <YAxis yAxisId="rain" orientation="right" reversed domain={[0, maxRain * 4]} tick={{ fontSize: 11, fill: '#90CAF9' }} stroke="rgba(255,255,255,0.4)" label={{ value: 'Mưa (mm)', angle: 90, position: 'insideRight', fill: '#90CAF9' }} />
                <Tooltip contentStyle={{ background: '#0D1B2A', border: '1px solid #1565C0', color: '#fff' }} />
                <Legend wrapperStyle={{ color: '#fff', fontSize: 12 }} />
                <AlertReferenceLines alertInfo={station?.alertInfo} />
                <Bar yAxisId="rain" dataKey="rain" name="Mưa (mm)" fill="#42A5F5" barSize={12} />
                <Area yAxisId="level" type="monotone" dataKey="level" name="Mực nước (m)" stroke="#42A5F5" strokeWidth={2} fill="#1565C0" fillOpacity={0.55} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mucnuoc-chart-cuongsuat">
          <div><b>Cường suất 1h:</b> {trendText(cuongSuat1h)}</div>
          <div><b>Cường suất 3h:</b> {trendText(cuongSuat3h)}</div>
          <div><b>Cường suất 6h:</b> {trendText(cuongSuat6h)}</div>
        </div>
      </div>
    </div>
  );
}
