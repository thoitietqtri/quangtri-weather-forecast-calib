// netlify/functions/lib/kttv-client.js
//
// Client dùng chung để gọi API KTTV (203.209.181.170) — tách riêng khỏi
// rainfall.js vì ở đây cần LẤY SỐ LIỆU THÔ (không cộng dồn theo giờ) để tự
// tính min/max nhiệt độ theo ngày, khác với logic cộng dồn mưa theo giờ bên
// rainfall.js.

const FETCH_TIMEOUT_MS = 6000;

function fmtDateTime(d) {
  // Server chạy giờ UTC, API hoạt động theo giờ Việt Nam (UTC+7).
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}-${p(vn.getUTCMonth() + 1)}-${p(vn.getUTCDate())} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}:${p(vn.getUTCSeconds())}`;
}

/**
 * Lấy chuỗi số liệu thô (KHÔNG cộng dồn) của 1 trạm KTTV trong khoảng
 * [start, end]. Trả về mảng [{ time: Date, value: number }], sắp theo thời
 * gian. Ném lỗi nếu API rỗng hoặc không parse được.
 */
export async function fetchKttvRawSeries(station, start, end) {
  const url = `http://203.209.181.170:2018/API_TTB/JSON/solieu.php`
    + `?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60`
    + `&tinhtong=${station.tinhtong ?? 0}&thoigianbd='${fmtDateTime(start)}'&thoigiankt='${fmtDateTime(end)}'`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('API trả về rỗng');

  const sample = rows[0];
  const sampleKeysLower = Object.keys(sample).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
  const findKey = (candidates) => {
    for (const c of candidates) {
      if (sampleKeysLower[c.toLowerCase()]) return sampleKeysLower[c.toLowerCase()];
    }
    return null;
  };
  const timeKey = findKey(['thoigian_sl', 'thoigian', 'thoi_gian']) || 'Thoigian_SL';
  const valKey = findKey(['solieu', 'so_lieu', 'nhietdo', 'nhiet_do', 'gia_tri', 'giatri']) || 'Solieu';

  const out = [];
  for (const r of rows) {
    const t = new Date(`${String(r[timeKey]).replace(' ', 'T')}+07:00`);
    if (Number.isNaN(t.getTime())) continue;
    const v = Number(String(r[valKey]).replace(',', '.'));
    if (Number.isNaN(v)) continue;
    out.push({ time: t, value: v });
  }
  if (out.length === 0) throw new Error(`Không parse được dòng nào (timeKey='${timeKey}', valKey='${valKey}')`);
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Khoảng [00:00:00, 23:59:59] theo giờ Việt Nam của 1 ngày (Date object, UTC-based). */
export function vnCalendarDayRange(dateVN) {
  // dateVN: {year, month (1-12), day}
  const { year, month, day } = dateVN;
  const p = (n) => String(n).padStart(2, '0');
  const start = new Date(`${year}-${p(month)}-${p(day)}T00:00:00+07:00`);
  const end = new Date(`${year}-${p(month)}-${p(day)}T23:59:59+07:00`);
  return { start, end };
}

/** Trả về { year, month, day } theo giờ Việt Nam, lùi lại `offsetDays` ngày so với hiện tại. */
export function vnDateParts(offsetDays = 0) {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3600 * 1000 + offsetDays * 86400000);
  return { year: vn.getUTCFullYear(), month: vn.getUTCMonth() + 1, day: vn.getUTCDate() };
}

export function dateStr({ year, month, day }) {
  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}
