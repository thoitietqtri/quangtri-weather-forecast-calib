import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

const CANH_BAO = { marginTop: 10, fontSize: 12, color: '#FFE082', background: 'rgba(249,168,37,0.14)', border: '1px solid rgba(249,168,37,0.6)' };

// Khung dự báo mực nước trạm TV Đồng Hới (gần cửa biển, lưu vực sông Nhật Lệ): hàm điều hòa thủy triều;
// khi Lệ Thủy từ báo động II (2,2m) trở lên thì kết hợp quan hệ Lệ Thủy - Đồng Hới.
export default function DongHoiForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (hs) => {
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (hs) params.set('hesoHieuChinh', hs);
    fetch(`/.netlify/functions/forecast-donghoi?${params.toString()}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(heSo); }, []);

  const lu = data && data.cheDo === 'lu_le_thuy';

  return (
    <div className="maihoa-forecast-overlay" onClick={onClose}>
      <div className="maihoa-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="maihoa-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước Đồng Hới</h3>
            <div className="maihoa-forecast-wip">Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị</div>
          </div>
          <button className="maihoa-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="maihoa-forecast-body">
          <div className="dongtam-forecast-hesobox">
            <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ):</label>
            <div className="dongtam-forecast-hesobox-row">
              <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
              <button onClick={() => load(heSo)}>Áp dụng</button>
            </div>
          </div>

          {error && <div className="maihoa-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="maihoa-forecast-loading">⏳ Đang tải...</div>}
          {data && !data.available && <div className="maihoa-forecast-empty">ℹ️ {data.reason}</div>}

          {data && data.available && (
            <>
              <div className="dongtam-forecast-hiennay">
                Đồng Hới hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.donghoiHienTai}m</b>
                {' | '}Lệ Thủy: {data.lethuyHienTai != null ? <b>{data.lethuyHienTai}m</b> : <b style={{ color: '#FFB74D' }}>mất số liệu</b>}
                {data.lethuyHienTai != null && (lu
                  ? ` (từ báo động II ${data.nguongLuLeThuy}m — mô hình triều kết hợp Lệ Thủy)`
                  : ` (dưới báo động II ${data.nguongLuLeThuy}m — mô hình triều)`)}
              </div>

              {data.thieuLeThuy && (
                <div className="maihoa-forecast-note" style={CANH_BAO}>
                  ⚠️ Lệ Thủy đang mất số liệu nên chưa kiểm tra được ngưỡng lũ. Kết quả tính bằng mô hình triều; nếu Lệ Thủy đang cao (từ báo động II) thì cần xem lại khi có số liệu.
                </div>
              )}
              {data.thieuMuaDuBao && (
                <div className="maihoa-forecast-note" style={CANH_BAO}>
                  ⚠️ Không lấy được mưa dự báo ECMWF — kết quả tính với mưa dự báo bằng 0, có thể thấp hơn thực tế nếu sắp có mưa.
                </div>
              )}
              {data.tang === 'rut_gon' && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12 }}>
                  ℹ️ Đồng Hới thiếu một số số liệu giờ trong 24 giờ qua nên dùng mô hình rút gọn (sai số tăng thêm một chút).
                </div>
              )}

              <table className="dongtam-forecast-table">
                <thead>
                  <tr><th></th><th>+6h</th><th>+12h</th><th>+18h</th><th>+24h</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Giờ</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}>{formatTimeVN(data.thoiDiemHienTai + h * 3600000)}</td>)}
                  </tr>
                  <tr className="dongtam-forecast-table-value">
                    <td>Mực nước</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}><b>{data.duBaoTheoMoc[h]}m</b></td>)}
                  </tr>
                </tbody>
              </table>

              <DuBaoChart
                hienTaiT={data.thoiDiemHienTai}
                hienTaiV={data.duongTrieu[0].v}
                duBaoTheoMoc={data.duBaoTheoMoc}
                duongCong={data.duongTrieu}
                diemCuc={[
                  { ...data.trieuCao, loai: 'cao' },
                  { ...data.trieuThap, loai: 'thap' },
                ]}
              />

              <div className="dongtam-forecast-dinh">
                🌊 Trong 24 giờ tới, triều cao nhất <b>{data.trieuCao.v}m</b> lúc {formatTimeVN(data.trieuCao.t)}; thấp nhất <b>{data.trieuThap.v}m</b> lúc {formatTimeVN(data.trieuThap.t)}
              </div>

              <div className="maihoa-forecast-inputs">
                {[6, 12, 18, 24].map((h) => (
                  <div className="maihoa-forecast-row" key={`q${h}`}>
                    <span>Mưa tại trạm {h}h đã qua:</span><b>{data.mucMuaDaQua[h]}mm</b>
                  </div>
                ))}
                {[6, 12, 18, 24].map((h) => (
                  <div className="maihoa-forecast-row" key={h}>
                    <span>Mưa dự báo +{h}h (tại trạm, ECMWF→HC):</span>
                    <b>{data.mucMuaDuBao[h].goc != null ? `${data.mucMuaDuBao[h].goc}mm → ${data.mucMuaDuBao[h].sauHieuChinh}mm` : 'không có'}</b>
                  </div>
                ))}
              </div>

              <div className="maihoa-forecast-note">
                📊 Mô hình triều: hàm điều hòa thủy triều dựng từ chính số liệu Đồng Hới 2006-2025, hiệu chỉnh theo mực nước thực đo 24 giờ gần nhất và mưa lưu vực (trung bình các trạm vùng thấp và Trường Sơn). Khi Lệ Thủy từ báo động II (2,2m) trở lên, thêm mực nước và cường suất lên, xuống của Lệ Thủy. Sai số trung bình (kiểm chứng ngoài mẫu, mưa dự báo đúng): ngày thường khoảng 0,06 đến 0,07m, khi có lũ khoảng 0,08 đến 0,13m; mưa dự báo sai thì kém hơn. Đây là thông tin tham khảo, không thay thế bản tin dự báo chính thức của Đài KTTV tỉnh Quảng Trị.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
