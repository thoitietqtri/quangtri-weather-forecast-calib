// netlify/functions/visit-counter.mjs
//
// Đếm lượt truy cập — mỗi lần frontend gọi vào đây (đúng 1 lần lúc trang
// tải xong) là +1 cho NGÀY HÔM NAY. Lưu bằng Netlify Blobs, KHÔNG cần
// database riêng. Trả về 5 số: hôm nay, hôm qua, tháng này, năm nay, tổng
// từ khi có bộ đếm.
//
// Thiết kế: lưu 2 loại khoá riêng biệt để vừa nhanh vừa chính xác —
//   - "total"           : 1 số chạy tổng từ trước đến giờ (đọc/tăng tức thì,
//                          không cần cộng dồn lại mỗi lần).
//   - "day:YYYY-MM-DD"   : số lượt riêng của từng ngày (giờ Việt Nam) — dùng
//                          để tính hôm qua/tháng này/năm nay bằng cách liệt
//                          kê + cộng dồn đúng nhóm ngày cần thiết (tối đa
//                          ~366 khoá cho 1 năm — vẫn rất nhanh).
//
// Lưu ý: Blobs không có phép "tăng nguyên tử" — đọc rồi ghi có thể lệch 1
// vài lượt hiếm khi nhiều người bấm cùng lúc. Chấp nhận được cho mục đích
// thống kê tham khảo.

import { getStore } from '@netlify/blobs';

function vnDateStr(offsetDays = 0) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400000);
  return vn.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getCount(store, key) {
  const v = await store.get(key, { type: 'json' });
  return v?.count || 0;
}

async function incrementCount(store, key) {
  const cur = await getCount(store, key);
  const next = cur + 1;
  await store.setJSON(key, { count: next });
  return next;
}

async function sumByPrefix(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const values = await Promise.all(blobs.map((b) => getCount(store, b.key)));
  return values.reduce((a, b) => a + b, 0);
}

export default async () => {
  try {
    const store = getStore({ name: 'visit-counter', consistency: 'strong' });

    const todayKey = `day:${vnDateStr(0)}`;
    const yesterdayKey = `day:${vnDateStr(-1)}`;
    const monthPrefix = `day:${vnDateStr(0).slice(0, 7)}`; // day:YYYY-MM
    const yearPrefix = `day:${vnDateStr(0).slice(0, 4)}`; // day:YYYY

    // Tăng đồng thời cả "total" (chạy tổng) và "hôm nay" (theo ngày) — đây
    // là 2 điểm ghi duy nhất mỗi lượt truy cập, còn lại chỉ đọc.
    const [total, today] = await Promise.all([
      incrementCount(store, 'total'),
      incrementCount(store, todayKey),
    ]);

    const [yesterday, month, year] = await Promise.all([
      getCount(store, yesterdayKey),
      sumByPrefix(store, monthPrefix),
      sumByPrefix(store, yearPrefix),
    ]);

    return new Response(JSON.stringify({ today, yesterday, month, year, total }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    console.error('[visit-counter] Lỗi:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 200 });
  }
};
