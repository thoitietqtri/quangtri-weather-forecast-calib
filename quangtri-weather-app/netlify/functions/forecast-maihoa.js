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
// LƯU Ý PHẠM VI: đây là mô hình "phản ứng" (reactive) — chỉ áp dụng SAU KHI
// Đồng Tâm đã đạt đỉnh thực đo, KHÔNG dùng mưa dự báo ECMWF (đó là bước mở
// rộng riêng, chưa làm ở đây).

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const HOURS_BACK = 168; // 7 ngày — đủ để phát hiện đỉnh + tính mưa 48h trước đỉnh an toàn

const DONGTAM = { matram: '555300', ten_table: 'mucnuoc_oday', tinhtong: '0' };
const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua' },  // Minh Hóa
  { matram: '557500', ten_table: 'mua_oday_khituong' }, // Tuyên Hóa
  { matram: '091402', ten_table: 'hanquoc_mua' },      // Thượng Hóa
  { matram: '091401', ten_table: 'hanquoc_mua' },      // Hóa Thanh
];

// Hệ số phương trình — huấn luyện offline, xem chi tiết trong ghi chú trên.
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
    // Tên trường trả về KHÔNG đồng nhất chữ hoa/thường giữa các bảng khác
    // nhau của KTTV (mực nước: "Solieu", mưa: "SoLieu") — tìm không phân
    // biệt hoa/thường để chắc chắn đọc đúng bất kể bảng nào.
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

function findValueAt(series, targetT, toleranceMs = 40 * 60 * 1000) {
  let best = null; let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= toleranceMs ? best.v : null;
}

// Tìm đỉnh lũ GẦN NHẤT đã được "xác nhận" — mực nước đã giảm/đi ngang liên
// tục ít nhất 3 giờ sau đỉnh (tránh báo nhầm lúc lũ còn đang lên, mới tạm
// chững lại).
// Tìm đỉnh lũ GẦN NHẤT đã được "xác nhận" — PHẢI là giá trị LỚN NHẤT trong
// toàn bộ chuỗi (không phải đỉnh cục bộ nhỏ lẻ, tránh nhầm 1 dao động tạm
// thời giữa lúc lũ đang lên thành "đỉnh đã qua"), và có ít nhất 3 giờ liên
// tiếp SAU đó đều KHÔNG vượt qua giá trị này (xác nhận nước đã thực sự qua
// đỉnh, đang xuống).
function findConfirmedPeak(series) {
  if (series.length < 10) return null;

  let maxIdx = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].v > series[maxIdx].v) maxIdx = i;
  }

  // Đỉnh còn quá gần "hiện tại" (chưa đủ 3 giờ dữ liệu sau nó để xác nhận)
  // -> lũ có thể vẫn đang lên, CHƯA xác nhận được đỉnh, không báo vội.
  if (maxIdx > series.length - 4) return null;

  for (let k = 1; k <= 3; k++) {
    if (series[maxIdx + k].v > series[maxIdx].v) return null;
  }

  return series[maxIdx];
}

export default async () => {
  try {
    const dongtamSeries = await fetchKttvSeries(DONGTAM, '0');
    if (dongtamSeries.length === 0) {
      return json({ available: false, reason: 'Không lấy được dữ liệu Đồng Tâm' });
    }

    const peak = findConfirmedPeak(dongtamSeries);
    if (!peak) {
      return json({ available: false, reason: 'Chưa phát hiện đỉnh lũ Đồng Tâm nào được xác nhận trong 7 ngày qua' });
    }

    const hoursAgo = (Date.now() - peak.t) / 3600000;
    if (hoursAgo > 96) {
      // Đỉnh quá cũ (>4 ngày) — không còn ý nghĩa vận hành, coi như không có
      return json({ available: false, reason: 'Đỉnh lũ gần nhất đã quá cũ (>96h), không còn phù hợp để dự báo' });
    }

    // Mưa lưu vực 48h trước đỉnh — lấy từ 4 trạm mưa, gộp trung bình theo giờ.
    const rainSeriesArr = await Promise.all(RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')));
    const rainByHour = new Map(); // epoch giờ tròn -> tổng các trạm / số trạm có dữ liệu
    for (const series of rainSeriesArr) {
      for (const p of series) {
        const bucket = Math.floor(p.t / 3600000) * 3600000;
        if (!rainByHour.has(bucket)) rainByHour.set(bucket, []);
        rainByHour.get(bucket).push(p.v);
      }
    }
    let rain48h = 0;
    for (let h = 0; h < 48; h++) {
      const bucket = Math.floor((peak.t - h * 3600000) / 3600000) * 3600000;
      const vals = rainByHour.get(bucket);
      if (vals && vals.length > 0) rain48h += vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    // Tốc độ lên 24h trước đỉnh
    const val24hBefore = findValueAt(dongtamSeries, peak.t - 24 * 3600000, 90 * 60 * 1000);
    const riseRate24h = val24hBefore != null ? (peak.v - val24hBefore) / 24 : 0;

    const dongtamPeakM = Math.round(peak.v) / 100; // dữ liệu API trả về cm
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
      hoursSincePeak: Math.round(hoursAgo * 10) / 10,
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
