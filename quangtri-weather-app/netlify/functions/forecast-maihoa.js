// netlify/functions/forecast-maihoa.js
//
// Dự báo đỉnh lũ trạm Mai Hóa dựa vào đỉnh lũ trạm Đồng Tâm — theo đúng
// phương pháp anh Hudson dùng thực tế (tương quan đỉnh-đỉnh), xây dựng từ
// 144 trận lũ lịch sử mưa-sinh-lũ (2006-2025), kiểm định chéo R²=0.833.
//
// Phương trình:
//   Đỉnh Mai Hóa (m) = -1.463 + 0.5713×(Đỉnh Đồng Tâm)
//                       + 0.0014×(Mưa lưu vực 48h trước đỉnh, mm)
//                       - 2.0315×(Tốc độ lên Đồng Tâm 24h trước đỉnh, m/h)
//
// LOGIC XÁC ĐỊNH "ĐÃ CÓ LŨ" VÀ "ĐÃ QUA ĐỈNH" (theo đúng yêu cầu 15/09):
//   1. CHỈ coi là đang có lũ khi Đồng Tâm đã vượt BĐI (7m). Dưới ngưỡng này
//      không xét, tránh báo nhầm dao động nhỏ bình thường thành "đỉnh lũ".
//   2. Trong đợt lũ gần nhất (liên tục >= BĐI), lấy điểm cao nhất làm "đỉnh
//      khả nghi" — CHƯA chốt ngay.
//   3. Chỉ CHỐT là đỉnh thật khi ĐỦ CẢ 3 điều kiện:
//      a. Mực nước đã không vượt qua đỉnh khả nghi trong ít nhất 3 giờ liên
//         tiếp gần nhất (dấu hiệu cơ bản đã qua đỉnh).
//      b. Mưa thực đo lưu vực đang giảm dần (tổng 6h gần nhất < tổng 6h
//         trước đó).
//      c. Mưa DỰ BÁO ECMWF lưu vực (trung bình 4 trạm) cho 24h tới < 50mm
//         HOẶC 12h tới < 25mm (không còn đợt mưa lớn mới sắp tới).
//   Nếu thiếu bất kỳ điều kiện nào -> CHƯA chốt đỉnh, không đưa ra dự báo
//   (tránh báo sớm khi lũ có thể còn tiếp tục lên).

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 168; // 7 ngày
const BDI_DONGTAM_M = 7; // Báo động I Đồng Tâm = 7m (dữ liệu API trả về ĐÃ LÀ MÉT, không phải cm)

const DONGTAM = { matram: '555300', ten_table: 'mucnuoc_oday', tinhtong: '0' };
const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969 },  // Minh Hóa
  { matram: '557500', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017 }, // Tuyên Hóa
  { matram: '091402', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967 },      // Thượng Hóa
  { matram: '091401', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8 },        // Hóa Thanh
];

const MODEL = { intercept: -1.463, dongtam: 0.5713, rain48h: 0.0014, riseRate24h: -2.0315 };

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

async function fetchKttvSeries(station, tinhtong = '1') {
  const end = vnNow();
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

// Mưa dự báo ECMWF (Open-Meteo) — trung bình 4 trạm, tổng 12h và 24h tới.
async function fetchForecastRain() {
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
  if (valid.length === 0) return { next12h: null, next24h: null };
  const hoursCount = Math.min(...valid.map((v) => v.length));
  let sum12 = 0, sum24 = 0;
  for (let h = 0; h < Math.min(24, hoursCount); h++) {
    const avgHour = valid.reduce((a, v) => a + (v[h] || 0), 0) / valid.length;
    if (h < 12) sum12 += avgHour;
    sum24 += avgHour;
  }
  return { next12h: Math.round(sum12 * 10) / 10, next24h: Math.round(sum24 * 10) / 10 };
}

export default async () => {
  try {
    const dongtamSeries = await fetchKttvSeries(DONGTAM, '0');
    if (dongtamSeries.length === 0) {
      return json({ available: false, reason: 'Không lấy được dữ liệu Đồng Tâm' });
    }

    // Bước 1: tìm đợt lũ GẦN NHẤT (liên tục >= BĐI = 7m)
    let episodeStart = -1;
    for (let i = dongtamSeries.length - 1; i >= 0; i--) {
      if (dongtamSeries[i].v >= BDI_DONGTAM_M) {
        episodeStart = i;
      } else if (episodeStart !== -1) {
        break; // đã lùi ra khỏi đợt lũ gần nhất
      }
    }
    if (episodeStart === -1) {
      return json({ available: false, reason: `Đồng Tâm chưa vượt báo động I (${BDI_DONGTAM_M}m) trong 7 ngày qua — chưa có lũ` });
    }
    // Tìm điểm kết thúc đợt lũ (lùi từ cuối chuỗi về, hoặc hết chuỗi nếu vẫn đang lũ)
    let episodeEnd = dongtamSeries.length - 1;
    for (let i = episodeStart; i < dongtamSeries.length; i++) {
      if (dongtamSeries[i].v < BDI_DONGTAM_M) { episodeEnd = i - 1; break; }
    }

    // Bước 2: đỉnh khả nghi = điểm cao nhất trong đợt lũ này
    let peakIdx = episodeStart;
    for (let i = episodeStart; i <= episodeEnd; i++) {
      if (dongtamSeries[i].v > dongtamSeries[peakIdx].v) peakIdx = i;
    }
    const peak = dongtamSeries[peakIdx];

    // Điều kiện (a): ít nhất 3 giờ sau đỉnh không vượt qua
    if (peakIdx > dongtamSeries.length - 4) {
      return json({ available: false, reason: 'Đồng Tâm đang trên báo động I nhưng chưa đủ dữ liệu xác nhận đã qua đỉnh (lũ có thể vẫn đang lên)', dongtamCurrentValue: Math.round(dongtamSeries[dongtamSeries.length - 1].v * 100) / 100 });
    }
    for (let k = 1; k <= 3; k++) {
      if (dongtamSeries[peakIdx + k].v > peak.v) {
        return json({ available: false, reason: 'Đồng Tâm đang trên báo động I nhưng chưa xác nhận đã qua đỉnh (mực nước vừa vượt lại)', dongtamCurrentValue: Math.round(dongtamSeries[dongtamSeries.length - 1].v * 100) / 100 });
      }
    }

    // Chuẩn bị dữ liệu mưa thực đo (4 trạm, gộp theo giờ)
    const rainSeriesArr = await Promise.all(RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')));
    const rainByHour = new Map();
    for (const series of rainSeriesArr) {
      for (const p of series) {
        const bucket = Math.floor(p.t / 3600000) * 3600000;
        if (!rainByHour.has(bucket)) rainByHour.set(bucket, []);
        rainByHour.get(bucket).push(p.v);
      }
    }

    // Điều kiện (b): mưa thực đo đang giảm dần (tổng 6h gần nhất < 6h trước đó)
    const nowT = Date.now();
    const rainLast6h = sumRainInWindow(rainByHour, nowT, 6);
    const rainPrev6h = sumRainInWindow(rainByHour, nowT - 6 * 3600000, 6);
    const rainDeclining = rainLast6h < rainPrev6h;

    // Điều kiện (c): mưa dự báo ECMWF đủ thấp
    const forecastRain = await fetchForecastRain();
    const forecastLow = (forecastRain.next24h != null && forecastRain.next24h < 50)
      || (forecastRain.next12h != null && forecastRain.next12h < 25);

    if (!rainDeclining || !forecastLow) {
      const reasons = [];
      if (!rainDeclining) reasons.push(`mưa thực đo 6h gần nhất (${Math.round(rainLast6h * 10) / 10}mm) chưa giảm so với 6h trước (${Math.round(rainPrev6h * 10) / 10}mm)`);
      if (!forecastLow) reasons.push(`mưa dự báo ECMWF còn lớn (24h tới: ${forecastRain.next24h ?? '—'}mm, 12h tới: ${forecastRain.next12h ?? '—'}mm)`);
      return json({
        available: false,
        reason: `Đồng Tâm có dấu hiệu tạm ngưng lên nhưng CHƯA đủ điều kiện xác nhận đỉnh: ${reasons.join('; ')}`,
        dongtamCurrentValue: Math.round(dongtamSeries[dongtamSeries.length - 1].v * 100) / 100,
        rainLast6h: Math.round(rainLast6h * 10) / 10,
        rainPrev6h: Math.round(rainPrev6h * 10) / 10,
        forecastNext12h: forecastRain.next12h,
        forecastNext24h: forecastRain.next24h,
      });
    }

    // Đủ điều kiện — chốt đỉnh thật, tính các biến đầu vào phương trình
    let rain48h = sumRainInWindow(rainByHour, peak.t, 48);
    const val24hBefore = findValueAt(dongtamSeries, peak.t - 24 * 3600000);
    const riseRate24h = val24hBefore != null ? (peak.v - val24hBefore) / 24 : 0;

    const dongtamPeakM = peak.v;
    const predicted = MODEL.intercept
      + MODEL.dongtam * dongtamPeakM
      + MODEL.rain48h * rain48h
      + MODEL.riseRate24h * riseRate24h;

    return json({
      available: true,
      dongtamPeakTime: peak.t,
      dongtamPeakValue: Math.round(dongtamPeakM * 100) / 100,
      rain48h: Math.round(rain48h * 10) / 10,
      riseRate24h: Math.round(riseRate24h * 1000) / 1000,
      predictedMaiHoaPeak: Math.round(predicted * 100) / 100,
      hoursSincePeak: Math.round(((Date.now() - peak.t) / 3600000) * 10) / 10,
      forecastNext12h: forecastRain.next12h,
      forecastNext24h: forecastRain.next24h,
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
