// netlify/functions/forecast-dongtam.js
//
// Dự báo mực nước Đồng Tâm 24h TỚI — trạm đầu nguồn, không có trạm nào ở
// trên để dùng mực nước, nên CHỈ dùng mưa (thực đo 24h qua + dự báo ECMWF
// 24h tới). Đây là dự báo THỰC SỰ hướng tới tương lai (khác Mai Hóa, vốn
// chỉ ước tính theo mực nước Đồng Tâm NGAY LÚC NÀY).
//
// Phương trình (huấn luyện từ 144 trận lũ, mô phỏng "dự báo hoàn hảo" 24h
// trước đỉnh để kiểm tra khả năng dùng mưa dự báo, R²=0.744 trên toàn bộ
// dữ liệu; kiểm định chéo thực tế: đạt chuẩn ±1m ~58%):
//   Đỉnh Đồng Tâm (m) = 4.3526 + 0.0036×(Mưa lưu vực 24h ĐÃ QUA)
//                                + 0.0391×(Mưa lưu vực 24h DỰ BÁO ECMWF)
//
// LƯU Ý QUAN TRỌNG: mưa dự báo ECMWF theo kinh nghiệm thực tế thường THẤP
// HƠN thực tế 2-2.5 lần lúc có hình thái cực đoan (bão/ATNĐ/đới gió đông
// kết hợp KKL) — có hệ số hiệu chỉnh thủ công (mặc định 1.0) để dự báo
// viên tự điều chỉnh theo đánh giá chuyên môn, KHÔNG tự động phát hiện.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 48;

const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969 },  // Minh Hóa
  { matram: '557500', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017 }, // Tuyên Hóa
  { matram: '091402', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967 },      // Thượng Hóa
  { matram: '091401', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8 },        // Hóa Thanh
];

const MODEL = { intercept: 4.3526, raQua: 0.0036, duBao: 0.0391 };

function vnNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}
function fmtVN(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchKttvSeries(station) {
  const end = vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=1`
    + `&thoigianbd='${fmtVN(start)}'&thoigiankt='${fmtVN(end)}'`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return [];
    const sampleKeys = Object.keys(js[0]).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
    const valKey = sampleKeys['solieu'] || 'Solieu';
    const timeKey = sampleKeys['thoigian_sl'] || 'Thoigian_SL';
    return js
      .map((r) => ({ t: new Date(`${r[timeKey]}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000, v: parseFloat(r[valKey]) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

function sumRainInWindow(rainByHour, endT, hours) {
  let sum = 0;
  for (let h = 0; h < hours; h++) {
    const bucket = Math.floor((endT - h * 3600000) / 3600000) * 3600000;
    const vals = rainByHour.get(bucket);
    if (vals && vals.length > 0) sum += vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return sum;
}

async function fetchForecastRainHourly() {
  const results = await Promise.all(RAIN_STATIONS.map(async (s) => {
    try {
      const url = `${OPENMETEO_FORECAST_URL}?latitude=${s.lat}&longitude=${s.lng}`
        + `&hourly=precipitation&forecast_days=2&timezone=Asia%2FBangkok&models=ecmwf_ifs`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return null;
      const js = await res.json();
      return js?.hourly?.precipitation || null;
    } catch {
      return null;
    }
  }));
  const valid = results.filter(Boolean);
  if (valid.length === 0) return null;
  const hoursCount = Math.min(...valid.map((v) => v.length));
  const avgHourly = [];
  for (let h = 0; h < hoursCount; h++) {
    avgHourly.push(valid.reduce((a, v) => a + (v[h] || 0), 0) / valid.length);
  }
  return avgHourly;
}

function sumWindow(arr, hours) {
  if (!arr) return null;
  return arr.slice(0, hours).reduce((a, b) => a + b, 0);
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    // Hệ số hiệu chỉnh mưa dự báo ECMWF — dự báo viên tự điều chỉnh theo
    // đánh giá chuyên môn (mặc định 1.0, gợi ý 2-2.5 lúc hình thái cực đoan).
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;

    const rainSeriesArr = await Promise.all(RAIN_STATIONS.map((s) => fetchKttvSeries(s)));
    const rainByHour = new Map();
    for (const series of rainSeriesArr) {
      for (const p of series) {
        const bucket = Math.floor(p.t / 3600000) * 3600000;
        if (!rainByHour.has(bucket)) rainByHour.set(bucket, []);
        rainByHour.get(bucket).push(p.v);
      }
    }
    if (rainByHour.size === 0) {
      return json({ available: false, reason: 'Không lấy được dữ liệu mưa thực đo' });
    }

    const now = vnNow().getTime();
    const rainDaQua24h = sumRainInWindow(rainByHour, now, 24);

    const forecastHourly = await fetchForecastRainHourly();
    if (!forecastHourly) {
      return json({ available: false, reason: 'Không lấy được mưa dự báo ECMWF', rainDaQua24h: Math.round(rainDaQua24h * 10) / 10 });
    }
    const rainDuBao24hGoc = sumWindow(forecastHourly, 24);
    const rainDuBao24h = rainDuBao24hGoc * heSoHieuChinh;

    const predicted = MODEL.intercept + MODEL.raQua * rainDaQua24h + MODEL.duBao * rainDuBao24h;

    return json({
      available: true,
      thoiDiemHienTai: now,
      rainDaQua24h: Math.round(rainDaQua24h * 10) / 10,
      rainDuBao24hGoc: Math.round(rainDuBao24hGoc * 10) / 10,
      heSoHieuChinh,
      rainDuBao24hSauHieuChinh: Math.round(rainDuBao24h * 10) / 10,
      predictedDongTam24hToi: Math.round(predicted * 100) / 100,
    });
  } catch (e) {
    return json({ available: false, reason: `Lỗi: ${e.message}` });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
