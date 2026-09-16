// netlify/functions/forecast-maihoa.js
//
// Dự báo mực nước Mai Hóa dựa vào mực nước HIỆN HÀNH của Đồng Tâm (coi mực
// nước hiện tại là "đỉnh" — có thể còn tăng thêm nếu lũ vẫn đang lên) — theo
// đúng cách đơn giản hoá anh Hudson chốt ngày 15/09/2026.
//
// Phương trình (xây từ 144 trận lũ lịch sử 2006-2025, kiểm định chéo R²=0.833):
//   Đỉnh Mai Hóa (m) = -1.463 + 0.5713×(Đồng Tâm hiện tại)
//                       + 0.0014×(Mưa lưu vực 48h qua) - 2.0315×(Tốc độ lên 24h qua)
//
// KHÁC BẢN TRƯỚC: KHÔNG còn chờ "xác nhận đỉnh" (bỏ hết điều kiện 3h/mưa
// giảm/ECMWF thấp) — chỉ cần đang trên BĐI là tính và hiện luôn, kèm nhận
// định xu thế tăng/giảm dựa vào mưa từng thời đoạn (1h/3h/6h/12h) — cả thực
// đo 24h qua lẫn dự báo ECMWF 24h tới — để dự báo viên tự đánh giá thêm.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 168;
const BDI_DONGTAM_M = 7; // Báo động I Đồng Tâm = 7m (dữ liệu API trả về ĐÃ LÀ MÉT)

const DONGTAM = { matram: '555300', ten_table: 'mucnuoc_oday', tinhtong: '0' };
const MAIHOA = { matram: '555400', ten_table: 'mucnuoc_oday', tinhtong: '0' };
const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969 },  // Minh Hóa
  { matram: '557500', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017 }, // Tuyên Hóa
  { matram: '091402', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967 },      // Thượng Hóa
  { matram: '091401', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8 },        // Hóa Thanh
  { matram: '555900', ten_table: 'mua_oday_thuyvan', lat: 17.9128, lng: 106.234 }, // Tân Lâm (nhánh Rào Trổ, phụ lưu cấp 1 — cùng đổ về Mai Hóa)
];

const MODEL = { intercept: -1.463, dongtam: 0.5713, rain48h: 0.0014, riseRate24h: -2.0315 };
const WINDOWS_H = [1, 3, 6, 12];

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

async function fetchKttvSeries(station, tinhtong = '1', refNow = null) {
  const end = refNow || vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=${tinhtong}`
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

function findValueAt(series, targetT, toleranceMs = 90 * 60 * 1000) {
  let best = null; let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= toleranceMs ? best.v : null;
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

// Mưa dự báo ECMWF (Open-Meteo, trung bình 5 trạm) — trả về mảng giờ tương
// lai để tự cộng dồn theo từng thời đoạn.
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
  return avgHourly; // avgHourly[0] = giờ hiện tại trở đi (theo giờ VN, do đã truyền timezone)
}

function sumWindow(arr, hours) {
  if (!arr) return null;
  return Math.round(arr.slice(0, hours).reduce((a, b) => a + b, 0) * 10) / 10;
}

// Nhận định xu thế mực nước 24h TỚI cho 1 trạm — kết hợp tốc độ lên/xuống 6h
// gần đây của CHÍNH trạm đó với mưa lưu vực (thực đo gần đây + dự báo ECMWF
// sắp tới, dùng ngầm bên trong, không hiển thị số thô ra giao diện).
function assessStationTrend(riseRate6h, obsRain6h, fcRain12h, fcRain24h) {
  const rising = riseRate6h > 0.02; // đang lên rõ rệt (>2cm/h)
  const falling = riseRate6h < -0.02; // đang xuống rõ rệt
  const moreRainComing = (fcRain24h != null && fcRain24h >= 30) || (fcRain12h != null && fcRain12h >= 20);
  const rainEnding = (fcRain24h != null && fcRain24h < 15) && (fcRain12h != null && fcRain12h < 10);

  if (rising && moreRainComing) return { verdict: 'Khả năng TIẾP TỤC TĂNG mạnh', icon: '📈' };
  if (rising && rainEnding) return { verdict: 'Đang lên nhưng mưa sắp dứt — khả năng sắp đạt đỉnh, tốc độ lên chậm dần', icon: '↗️' };
  if (rising) return { verdict: 'Đang lên, xu thế mưa chưa rõ ràng — cần theo dõi thêm', icon: '↗️' };
  if (falling && moreRainComing) return { verdict: 'Đang xuống nhưng dự báo còn mưa lớn — có thể LÊN TRỞ LẠI', icon: '⚠️' };
  if (falling) return { verdict: 'Khả năng TIẾP TỤC GIẢM', icon: '📉' };
  // gần như đi ngang
  if (moreRainComing) return { verdict: 'Đang ổn định nhưng dự báo còn mưa lớn — có thể bắt đầu lên', icon: '⚠️' };
  return { verdict: 'Tương đối ổn định', icon: '➡️' };
}

export default async (request) => {
  try {
    // Tham số "asof" (tùy chọn) — CHỈ dùng để kiểm nghiệm lại quá khứ, giả
    // lập "bây giờ" là 1 mốc thời gian đã qua (ví dụ đúng lúc sông Gianh có
    // lũ), xem hệ thống lúc đó sẽ hiện dự báo gì. Ví dụ:
    //   /.netlify/functions/forecast-maihoa?asof=2026-09-14%2005:00:00
    // Bỏ trống tham số này -> chạy đúng như bình thường (dùng giờ hiện tại
    // thật). Lưu ý: ở chế độ kiểm nghiệm, KHÔNG có mưa dự báo ECMWF của quá
    // khứ (mô hình dự báo không lưu lại lịch sử) — phần đó sẽ bỏ qua, chỉ
    // đánh giá theo đúng số liệu thực đo tại mốc đó.
    const url = new URL(request.url);
    const asofParam = url.searchParams.get('asof');
    let refNow = null;
    let backtestMode = false;
    if (asofParam) {
      // Coi chuỗi nhập vào (VD "2026-09-14 05:00:00") là giờ VN — parse
      // thẳng thành UTC bằng cách thêm hậu tố Z, đúng khớp quy ước nội bộ
      // vnNow() đang dùng (đọc field UTC ra đúng số giờ VN theo nghĩa đen).
      const parsed = new Date(asofParam.trim().replace(' ', 'T') + 'Z');
      if (!Number.isNaN(parsed.getTime())) {
        refNow = parsed;
        backtestMode = true;
      }
    }

    const [dongtamSeries, maihoaSeries] = await Promise.all([
      fetchKttvSeries(DONGTAM, '0', refNow),
      fetchKttvSeries(MAIHOA, '0', refNow),
    ]);
    if (dongtamSeries.length === 0) {
      return json({ available: false, reason: 'Không lấy được dữ liệu Đồng Tâm', backtestMode });
    }
    const current = dongtamSeries[dongtamSeries.length - 1];
    if (current.v < BDI_DONGTAM_M) {
      return json({ available: false, reason: `Đồng Tâm chưa vượt báo động I (${BDI_DONGTAM_M}m) — chưa có lũ`, dongtamCurrentValue: Math.round(current.v * 100) / 100, backtestMode });
    }

    // Mưa thực đo (5 trạm, gộp theo giờ)
    const rainSeriesArr = await Promise.all(RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1', refNow)));
    const rainByHour = new Map();
    for (const series of rainSeriesArr) {
      for (const p of series) {
        const bucket = Math.floor(p.t / 3600000) * 3600000;
        if (!rainByHour.has(bucket)) rainByHour.set(bucket, []);
        rainByHour.get(bucket).push(p.v);
      }
    }

    const obsRain6h = sumRainInWindow(rainByHour, current.t, 6);

    // Mưa dự báo ECMWF — CHỈ có ý nghĩa ở chế độ chạy thật (không có "dự báo
    // của quá khứ" để kiểm nghiệm lại).
    let fcRain12h = null;
    let fcRain24h = null;
    if (!backtestMode) {
      const forecastHourly = await fetchForecastRainHourly();
      fcRain12h = sumWindow(forecastHourly, 12);
      fcRain24h = sumWindow(forecastHourly, 24);
    }

    // Coi mực nước HIỆN TẠI (hoặc tại mốc "asof") là "đỉnh" (có thể còn tăng thêm)
    const rain48h = sumRainInWindow(rainByHour, current.t, 48);
    const val24hBefore = findValueAt(dongtamSeries, current.t - 24 * 3600000);
    const riseRate24h = val24hBefore != null ? (current.v - val24hBefore) / 24 : 0;

    const predicted = MODEL.intercept
      + MODEL.dongtam * current.v
      + MODEL.rain48h * rain48h
      + MODEL.riseRate24h * riseRate24h;

    const dongtamRise6h = findValueAt(dongtamSeries, current.t - 6 * 3600000) != null
      ? (current.v - findValueAt(dongtamSeries, current.t - 6 * 3600000)) / 6 : 0;
    const dongtamTrend = assessStationTrend(dongtamRise6h, obsRain6h, fcRain12h, fcRain24h);

    let maihoaTrend = null;
    let maihoaCurrentValue = null;
    let maihoaCurrentTime = null;
    if (maihoaSeries.length > 0) {
      const mhCurrent = maihoaSeries[maihoaSeries.length - 1];
      maihoaCurrentValue = Math.round(mhCurrent.v * 100) / 100;
      maihoaCurrentTime = mhCurrent.t;
      const mh6hAgo = findValueAt(maihoaSeries, mhCurrent.t - 6 * 3600000);
      const maihoaRise6h = mh6hAgo != null ? (mhCurrent.v - mh6hAgo) / 6 : 0;
      maihoaTrend = assessStationTrend(maihoaRise6h, obsRain6h, fcRain12h, fcRain24h);
    }

    return json({
      available: true,
      backtestMode,
      asof: asofParam || null,
      dongtamCurrentTime: current.t,
      dongtamCurrentValue: Math.round(current.v * 100) / 100,
      rain48h: Math.round(rain48h * 10) / 10,
      riseRate24h: Math.round(riseRate24h * 1000) / 1000,
      predictedMaiHoaPeak: Math.round(predicted * 100) / 100,
      dongtamTrend,
      maihoaTrend,
      maihoaCurrentValue,
      // Ở chế độ kiểm nghiệm, kèm luôn giá trị Mai Hóa THẬT tại đúng mốc đó
      // để đối chiếu ngay dự báo vs thực tế — không cần tra cứu riêng.
      maihoaActualAtSameTime: backtestMode ? maihoaCurrentValue : undefined,
      maihoaActualTime: backtestMode ? maihoaCurrentTime : undefined,
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
