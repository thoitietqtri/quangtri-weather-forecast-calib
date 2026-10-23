// netlify/functions/feedback.mjs
//
// Góp ý của người dùng cho admin. Lưu bằng Netlify Blobs (giống bộ đếm truy cập), KHÔNG gửi đi đâu (không email/Zalo).
// Chỉ đọc được trong app, sau khi nhập mật khẩu:
//   - GOPY_ADMIN_PASS : mật khẩu admin — xem, đánh dấu "đã xử lý", ghi chú, xóa.
//   - GOPY_VIEW_PASS  : mật khẩu người xem — chỉ đọc. Có thể đặt nhiều mật khẩu, cách nhau bằng dấu phẩy
//                       (mỗi người một mật khẩu; thu hồi bằng cách xóa mật khẩu đó rồi deploy lại).
// Cả hai đặt trong Netlify > Site configuration > Environment variables, KHÔNG nằm trong code.
//
// Tất cả hành động dùng POST, body JSON { act, ... }:
//   act=gui      (ai cũng gửi được)  { muc, loai, noiDung, lienHe, nguCanh, website }  — "website" là ô ẩn chặn bot, phải để trống
//   act=xem      (mật khẩu)          trả danh sách góp ý mới nhất trước
//   act=capnhat  (admin)             { id, trangThai: 'moi'|'daxuly', ghiChu }
//   act=xoa      (admin)             { id }
// Mật khẩu gửi qua header "x-gopy-pass" (không để trên URL).
//
// Chống spam: mỗi thiết bị/mạng tối đa 5 góp ý mỗi ngày; sai mật khẩu quá 10 lần/giờ thì khóa 1 giờ.
// IP không được lưu nguyên văn, chỉ băm (SHA-256 kèm muối) để đếm giới hạn.

import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const MUC = ['Dự báo thời tiết xã/phường', 'Mưa thực đo', 'Mực nước thực đo', 'Dự báo mực nước các trạm', 'Radar', 'Trợ lý', 'Giao diện / cài app', 'Khác'];
const LOAI = ['Sai số / số liệu', 'Lỗi hiển thị', 'Đề xuất tính năng', 'Khác'];
const MAX_NOIDUNG = 1000;
const MAX_NGAY = 5;
const MAX_SAI_MK = 10;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const cat = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

function bamIp(request) {
  const ip = request.headers.get('x-nf-client-connection-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'khong-ro';
  return createHash('sha256').update(`gopy-muoi:${ip}`).digest('hex').slice(0, 24);
}
function giongNhau(a, b) {
  const x = createHash('sha256').update(String(a)).digest(); const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}
function vaiTro(mk) {
  const admin = (process.env.GOPY_ADMIN_PASS || '').trim();
  const xem = (process.env.GOPY_VIEW_PASS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!mk) return null;
  if (admin && giongNhau(mk, admin)) return 'admin';
  if (xem.some((p) => giongNhau(mk, p))) return 'xem';
  return null;
}
async function tang(store, key) {
  const v = await store.get(key, { type: 'json' });
  const n = (v?.n || 0) + 1;
  await store.setJSON(key, { n });
  return n;
}
function loaiThietBi(ua) {
  const s = String(ua || '');
  if (/iPhone|iPad|iPod/i.test(s)) return 'iPhone/iPad';
  if (/Android/i.test(s)) return 'Android';
  if (/Windows|Macintosh|Linux|X11/i.test(s)) return 'Máy tính';
  return 'Không rõ';
}

export default async (request) => {
  if (request.method !== 'POST') return json({ ok: false, loi: 'Chỉ nhận POST' }, 405);
  try {
    let body = {};
    try { body = await request.json(); } catch { return json({ ok: false, loi: 'Dữ liệu gửi lên không hợp lệ' }, 400); }
    const store = getStore({ name: 'gop-y', consistency: 'strong' });
    const ip = bamIp(request);
    const ngay = vnNow().toISOString().slice(0, 10);
    const gio = vnNow().toISOString().slice(0, 13);

    if (body.act === 'gui') {
      if (body.website) return json({ ok: true }); // bot điền ô ẩn: giả vờ thành công, không lưu
      const noiDung = cat(body.noiDung, MAX_NOIDUNG);
      if (noiDung.length < 5) return json({ ok: false, loi: 'Anh/chị vui lòng viết nội dung góp ý (ít nhất 5 ký tự).' }, 400);
      const n = await tang(store, `gh:${ip}:${ngay}`);
      if (n > MAX_NGAY) return json({ ok: false, loi: `Hôm nay đã gửi đủ ${MAX_NGAY} góp ý, mời anh/chị gửi tiếp vào ngày mai.` }, 429);
      const t = vnNow();
      const id = `${t.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
      const muc = MUC.includes(body.muc) ? body.muc : 'Khác';
      const loai = LOAI.includes(body.loai) ? body.loai : 'Khác';
      await store.setJSON(`gy:${id}`, {
        id, thoiGian: t.toISOString().slice(0, 19).replace('T', ' '), muc, loai, noiDung,
        lienHe: cat(body.lienHe, 100), nguCanh: cat(body.nguCanh, 300), thietBi: loaiThietBi(request.headers.get('user-agent')),
        trangThai: 'moi', ghiChu: '',
      });
      return json({ ok: true });
    }

    // các hành động còn lại cần mật khẩu
    if (!process.env.GOPY_ADMIN_PASS && !process.env.GOPY_VIEW_PASS) return json({ ok: false, loi: 'Chưa cài mật khẩu xem góp ý trên Netlify (GOPY_ADMIN_PASS / GOPY_VIEW_PASS).' }, 503);
    const sai = (await store.get(`sai:${ip}:${gio}`, { type: 'json' }))?.n || 0;
    if (sai >= MAX_SAI_MK) return json({ ok: false, loi: 'Nhập sai mật khẩu quá nhiều lần, mời thử lại sau 1 giờ.' }, 429);
    const vt = vaiTro(request.headers.get('x-gopy-pass'));
    if (!vt) { await tang(store, `sai:${ip}:${gio}`); return json({ ok: false, loi: 'Sai mật khẩu.' }, 401); }

    if (body.act === 'xem') {
      const { blobs } = await store.list({ prefix: 'gy:' });
      const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 500);
      const ds = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' })))).filter(Boolean);
      return json({ ok: true, vaiTro: vt, tong: blobs.length, danhSach: ds, muc: MUC, loai: LOAI });
    }
    if (vt !== 'admin') return json({ ok: false, loi: 'Mật khẩu này chỉ được xem, không được sửa hoặc xóa.' }, 403);
    const id = cat(body.id, 40);
    if (!/^[0-9]{14}-[0-9a-f]{6}$/.test(id)) return json({ ok: false, loi: 'Mã góp ý không hợp lệ' }, 400);
    const key = `gy:${id}`;
    const cu = await store.get(key, { type: 'json' });
    if (!cu) return json({ ok: false, loi: 'Không tìm thấy góp ý (có thể đã bị xóa).' }, 404);
    if (body.act === 'capnhat') {
      const moi = { ...cu, trangThai: body.trangThai === 'daxuly' ? 'daxuly' : 'moi', ghiChu: cat(body.ghiChu, 500) };
      await store.setJSON(key, moi);
      return json({ ok: true, gopY: moi });
    }
    if (body.act === 'xoa') { await store.delete(key); return json({ ok: true }); }
    return json({ ok: false, loi: 'Hành động không hợp lệ' }, 400);
  } catch (e) {
    console.error('[feedback] Lỗi:', e);
    return json({ ok: false, loi: 'Lỗi máy chủ, mời thử lại sau.' }, 500);
  }
};
