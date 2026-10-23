import { useEffect, useState } from 'react';
import './GopY.css';

// Góp ý của người dùng cho admin. Gửi lên hàm /.netlify/functions/feedback (lưu bằng Netlify Blobs, không gửi email/Zalo).
// Phần xem góp ý (quản trị) chỉ mở được khi nhập mật khẩu: bấm "🔒 Quản trị" cuối khung góp ý, hoặc mở địa chỉ app kèm #quan-tri-gop-y.
const API = '/.netlify/functions/feedback';
const HASH_QUAN_TRI = '#quan-tri-gop-y';
const MUC = ['Dự báo thời tiết xã/phường', 'Mưa thực đo', 'Mực nước thực đo', 'Dự báo mực nước các trạm', 'Radar', 'Trợ lý', 'Giao diện / cài app', 'Khác'];
const LOAI = ['Sai số / số liệu', 'Lỗi hiển thị', 'Đề xuất tính năng', 'Khác'];
const KHOA_MK = 'gopy.matkhau';

const luu = (k, v) => { try { if (v == null) window.sessionStorage.removeItem(k); else window.sessionStorage.setItem(k, v); } catch { /* bỏ qua */ } };
const doc = (k) => { try { return window.sessionStorage.getItem(k); } catch { return null; } };

async function goi(body, matKhau) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(matKhau ? { 'x-gopy-pass': matKhau } : {}) }, body: JSON.stringify(body) });
  let j = null;
  try { j = await res.json(); } catch { /* không phải JSON */ }
  if (!j) throw new Error('Máy chủ không phản hồi đúng, mời thử lại.');
  return j;
}

function KhungGui({ nguCanh, onDong, moQuanTri }) {
  const [muc, setMuc] = useState(MUC[0]);
  const [loai, setLoai] = useState(LOAI[0]);
  const [noiDung, setNoiDung] = useState('');
  const [lienHe, setLienHe] = useState('');
  const [website, setWebsite] = useState(''); // ô ẩn chặn bot
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState('');
  const [xong, setXong] = useState(false);

  const gui = async () => {
    setLoi('');
    if (noiDung.trim().length < 5) { setLoi('Anh/chị vui lòng viết nội dung góp ý (ít nhất 5 ký tự).'); return; }
    setDangGui(true);
    try {
      const j = await goi({ act: 'gui', muc, loai, noiDung, lienHe, nguCanh, website });
      if (j.ok) { setXong(true); setNoiDung(''); } else setLoi(j.loi || 'Không gửi được, mời thử lại.');
    } catch (e) { setLoi(e.message); }
    setDangGui(false);
  };

  return (
    <>
      <div className="gopy-header">
        <div>
          <h3>💬 Góp ý cho admin</h3>
          <div className="gopy-sub">Góp ý chỉ admin đọc trong app, không đăng công khai.</div>
        </div>
        <button className="gopy-close" onClick={onDong} aria-label="Đóng">✕</button>
      </div>
      <div className="gopy-body">
        {xong ? (
          <div className="gopy-ok">
            <p>✅ Cảm ơn anh/chị đã góp ý. Admin sẽ xem và tiếp thu.</p>
            <button className="gopy-btn" onClick={() => setXong(false)}>Gửi góp ý khác</button>
            <button className="gopy-btn gopy-btn--phu" onClick={onDong}>Đóng</button>
          </div>
        ) : (
          <>
            <label className="gopy-lb">Góp ý về nội dung/chức năng
              <select value={muc} onChange={(e) => setMuc(e.target.value)}>{MUC.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="gopy-lb">Loại góp ý
              <select value={loai} onChange={(e) => setLoai(e.target.value)}>{LOAI.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="gopy-lb">Nội dung góp ý
              <textarea rows={6} maxLength={1000} value={noiDung} onChange={(e) => setNoiDung(e.target.value)} placeholder="Anh/chị mô tả điều cần góp ý (càng cụ thể càng tốt)…" />
              <span className="gopy-dem">{noiDung.length}/1000</span>
            </label>
            <label className="gopy-lb">Liên hệ (không bắt buộc)
              <input type="text" maxLength={100} value={lienHe} onChange={(e) => setLienHe(e.target.value)} placeholder="Zalo hoặc email, nếu muốn admin phản hồi" />
              <span className="gopy-dem">Chỉ admin đọc được, chỉ dùng để phản hồi góp ý này.</span>
            </label>
            <input className="gopy-an" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
            {nguCanh && <div className="gopy-ngucanh">Tự động kèm theo: {nguCanh}</div>}
            {loi && <div className="gopy-loi">⚠️ {loi}</div>}
            <button className="gopy-btn" onClick={gui} disabled={dangGui}>{dangGui ? 'Đang gửi…' : 'Gửi góp ý'}</button>
            <button className="gopy-quantri" onClick={moQuanTri}>🔒 Quản trị</button>
          </>
        )}
      </div>
    </>
  );
}

function KhungQuanTri({ onDong }) {
  const [mk, setMk] = useState('');
  const [phien, setPhien] = useState(null); // { matKhau, vaiTro, danhSach, tong }
  const [loi, setLoi] = useState('');
  const [dang, setDang] = useState(false);
  const [locMuc, setLocMuc] = useState('');
  const [locLoai, setLocLoai] = useState('');
  const [locTT, setLocTT] = useState('');
  const [xacNhanXoa, setXacNhanXoa] = useState('');
  const [ghiChuNhap, setGhiChuNhap] = useState({});

  const tai = async (matKhau) => {
    setDang(true); setLoi('');
    try {
      const j = await goi({ act: 'xem' }, matKhau);
      if (j.ok) { luu(KHOA_MK, matKhau); setPhien({ matKhau, vaiTro: j.vaiTro, danhSach: j.danhSach, tong: j.tong }); } else { luu(KHOA_MK, null); setPhien(null); setLoi(j.loi || 'Không xem được.'); }
    } catch (e) { setLoi(e.message); }
    setDang(false);
  };
  useEffect(() => { const s = doc(KHOA_MK); if (s) tai(s); }, []);

  const capNhat = async (g, trangThai) => {
    setDang(true); setLoi('');
    try {
      const j = await goi({ act: 'capnhat', id: g.id, trangThai, ghiChu: ghiChuNhap[g.id] ?? g.ghiChu }, phien.matKhau);
      if (j.ok) setPhien((p) => ({ ...p, danhSach: p.danhSach.map((x) => (x.id === g.id ? j.gopY : x)) })); else setLoi(j.loi);
    } catch (e) { setLoi(e.message); }
    setDang(false);
  };
  const xoa = async (g) => {
    if (xacNhanXoa !== g.id) { setXacNhanXoa(g.id); return; }
    setDang(true); setLoi('');
    try {
      const j = await goi({ act: 'xoa', id: g.id }, phien.matKhau);
      if (j.ok) setPhien((p) => ({ ...p, tong: p.tong - 1, danhSach: p.danhSach.filter((x) => x.id !== g.id) })); else setLoi(j.loi);
    } catch (e) { setLoi(e.message); }
    setXacNhanXoa(''); setDang(false);
  };
  const dangXuat = () => { luu(KHOA_MK, null); setPhien(null); setMk(''); };

  const ds = phien ? phien.danhSach.filter((g) => (!locMuc || g.muc === locMuc) && (!locLoai || g.loai === locLoai) && (!locTT || g.trangThai === locTT)) : [];
  const admin = phien && phien.vaiTro === 'admin';

  return (
    <>
      <div className="gopy-header">
        <div>
          <h3>🔒 Xem góp ý</h3>
          <div className="gopy-sub">{phien ? `${phien.vaiTro === 'admin' ? 'Admin' : 'Người xem (chỉ đọc)'} · ${phien.tong} góp ý` : 'Nhập mật khẩu để xem'}</div>
        </div>
        <button className="gopy-close" onClick={onDong} aria-label="Đóng">✕</button>
      </div>
      <div className="gopy-body">
        {!phien ? (
          <>
            <label className="gopy-lb">Mật khẩu
              <input type="password" value={mk} onChange={(e) => setMk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && mk) tai(mk); }} autoComplete="current-password" />
            </label>
            {loi && <div className="gopy-loi">⚠️ {loi}</div>}
            <button className="gopy-btn" disabled={!mk || dang} onClick={() => tai(mk)}>{dang ? 'Đang kiểm tra…' : 'Xem góp ý'}</button>
          </>
        ) : (
          <>
            <div className="gopy-loc">
              <select value={locMuc} onChange={(e) => setLocMuc(e.target.value)}><option value="">Tất cả mục</option>{MUC.map((m) => <option key={m}>{m}</option>)}</select>
              <select value={locLoai} onChange={(e) => setLocLoai(e.target.value)}><option value="">Tất cả loại</option>{LOAI.map((m) => <option key={m}>{m}</option>)}</select>
              <select value={locTT} onChange={(e) => setLocTT(e.target.value)}><option value="">Mọi trạng thái</option><option value="moi">Mới</option><option value="daxuly">Đã xử lý</option></select>
            </div>
            <div className="gopy-hang">
              <button className="gopy-btn gopy-btn--nho" onClick={() => tai(phien.matKhau)} disabled={dang}>↻ Làm mới</button>
              <button className="gopy-btn gopy-btn--nho gopy-btn--phu" onClick={dangXuat}>Đăng xuất</button>
              <span className="gopy-dem">Hiện {ds.length}/{phien.danhSach.length}</span>
            </div>
            {loi && <div className="gopy-loi">⚠️ {loi}</div>}
            {ds.length === 0 && <div className="gopy-trong">Chưa có góp ý nào khớp bộ lọc.</div>}
            {ds.map((g) => (
              <div key={g.id} className={`gopy-the${g.trangThai === 'daxuly' ? ' gopy-the--xong' : ''}`}>
                <div className="gopy-the-dau">
                  <b>{g.muc}</b><span className="gopy-chip">{g.loai}</span>
                  <span className={`gopy-chip ${g.trangThai === 'daxuly' ? 'gopy-chip--xanh' : 'gopy-chip--cam'}`}>{g.trangThai === 'daxuly' ? 'Đã xử lý' : 'Mới'}</span>
                </div>
                <div className="gopy-the-gio">{g.thoiGian} · {g.thietBi}{g.nguCanh ? ` · ${g.nguCanh}` : ''}</div>
                <div className="gopy-the-nd">{g.noiDung}</div>
                {g.lienHe && <div className="gopy-the-lh">📞 Liên hệ: {g.lienHe}</div>}
                {admin ? (
                  <>
                    <textarea rows={2} maxLength={500} placeholder="Ghi chú của admin…" value={ghiChuNhap[g.id] ?? g.ghiChu} onChange={(e) => setGhiChuNhap((s) => ({ ...s, [g.id]: e.target.value }))} />
                    <div className="gopy-hang">
                      <button className="gopy-btn gopy-btn--nho" disabled={dang} onClick={() => capNhat(g, g.trangThai)}>Lưu ghi chú</button>
                      <button className="gopy-btn gopy-btn--nho gopy-btn--phu" disabled={dang} onClick={() => capNhat(g, g.trangThai === 'daxuly' ? 'moi' : 'daxuly')}>{g.trangThai === 'daxuly' ? 'Mở lại' : '✓ Đã xử lý'}</button>
                      <button className="gopy-btn gopy-btn--nho gopy-btn--do" disabled={dang} onClick={() => xoa(g)}>{xacNhanXoa === g.id ? 'Bấm lại để xóa' : 'Xóa'}</button>
                    </div>
                  </>
                ) : (g.ghiChu && <div className="gopy-the-lh">📝 Ghi chú admin: {g.ghiChu}</div>)}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

export default function GopY({ mo, onDong, nguCanh }) {
  const [quanTri, setQuanTri] = useState(() => typeof window !== 'undefined' && window.location.hash === HASH_QUAN_TRI);
  useEffect(() => {
    const f = () => { if (window.location.hash === HASH_QUAN_TRI) setQuanTri(true); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  if (!mo && !quanTri) return null;
  const dongQuanTri = () => {
    setQuanTri(false);
    if (window.location.hash === HASH_QUAN_TRI) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (mo) onDong();
  };
  return (
    <div className="gopy-overlay" onClick={quanTri ? undefined : onDong}>
      <div className="gopy-panel" onClick={(e) => e.stopPropagation()}>
        {quanTri ? <KhungQuanTri onDong={dongQuanTri} /> : <KhungGui nguCanh={nguCanh} onDong={onDong} moQuanTri={() => setQuanTri(true)} />}
      </div>
    </div>
  );
}
