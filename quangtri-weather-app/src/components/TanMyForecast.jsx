import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

const CANH_BAO = { marginTop: 10, fontSize: 12, color: '#FFE082', background: 'rgba(249,168,37,0.14)', border: '1px solid rgba(249,168,37,0.6)' };

// Khung dự báo mực nước trạm TV Tân Mỹ (gần cửa biển, lưu vực sông Gianh): hàm điều hòa thủy triều;
// khi Mai Hóa từ báo động II (5,0m) trở lên thì hiệu chỉnh theo mực nước Mai Hóa.
export default function TanMyForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (hs) => {
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (hs) params.set('hesoHieuChinh', hs);
    fetch(`/.netlify/functions/forecast-tanmy?${params.toString()}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(heSo); }, []);

  const lu = data && data.cheDo === 'lu_mai_hoa';
  const khongTM = data && data.available && data.phuongAn === 'khong_tanmy';
  const uocDH = data && data.available && data.phuongAn === 'uoc_tu_donghoi';

  return (
    <div className="maihoa-forecast-overlay" onClick={onClose}>
      <div className="maihoa-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="maihoa-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước Tân Mỹ</h3>
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
                {uocDH ? (
                  <>
                    Tân Mỹ: <b style={{ color: '#FFB74D' }}>không có số liệu quan trắc</b> | Tân Mỹ ước từ Đồng Hới — phương án 2 ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.tanmyUocHienTai}m</b>
                    {data.donghoiHienTai != null ? ` (Đồng Hới ${data.donghoiHienTai}m)` : ''} | Mai Hóa: <b>{data.maihoaHienTai}m</b>
                    {data.maihoaHienTai >= data.nguongLuMaiHoa ? ` (từ báo động II ${data.nguongLuMaiHoa}m)` : ` (dưới báo động II ${data.nguongLuMaiHoa}m)`}
                  </>
                ) : khongTM ? (
                  <>
                    Tân Mỹ: <b style={{ color: '#FFB74D' }}>không có số liệu quan trắc</b> | Mai Hóa ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.maihoaHienTai}m</b> — phương án 3 (chỉ triều, mùa vụ, Mai Hóa và mưa)
                    {data.maihoaHienTai >= data.nguongLuMaiHoa ? ` (từ báo động II ${data.nguongLuMaiHoa}m)` : ` (dưới báo động II ${data.nguongLuMaiHoa}m)`}
                  </>
                ) : (
                  <>
                    Tân Mỹ hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.tanmyHienTai}m</b>
                    {' | '}Mai Hóa: {data.maihoaHienTai != null ? <b>{data.maihoaHienTai}m</b> : <b style={{ color: '#FFB74D' }}>mất số liệu</b>}
                    {data.maihoaHienTai != null && (lu
                      ? ` (từ báo động II ${data.nguongLuMaiHoa}m — mô hình triều có hiệu chỉnh theo Mai Hóa)`
                      : ` (dưới báo động II ${data.nguongLuMaiHoa}m — mô hình triều)`)}
                  </>
                )}
              </div>

              {data.thieuMaiHoa && (
                <div className="maihoa-forecast-note" style={CANH_BAO}>
                  ⚠️ Mai Hóa đang mất số liệu nên chưa kiểm tra được ngưỡng lũ. Kết quả tính bằng mô hình triều; nếu Mai Hóa đang cao (từ báo động II) thì cần xem lại khi có số liệu.
                </div>
              )}
              {data.thieuMuaDuBao && (
                <div className="maihoa-forecast-note" style={CANH_BAO}>
                  ⚠️ Không lấy được mưa dự báo ECMWF — kết quả tính với mưa dự báo bằng 0, có thể thấp hơn thực tế nếu sắp có mưa.
                </div>
              )}
              {data.tang === 'rut_gon' && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12 }}>
                  ℹ️ Tân Mỹ thiếu một số số liệu giờ trong 24 giờ qua nên dùng mô hình rút gọn (sai số tăng thêm một chút).
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
                📊 Mô hình triều (phương án 1, có số liệu Tân Mỹ): hàm điều hòa thủy triều dựng từ chính số liệu Tân Mỹ các năm đo tốt (2011 đến 2025, bỏ 2015 và 2016 do cảm biến lỗi), hiệu chỉnh theo mực nước thực đo 24 giờ gần nhất và mưa lưu vực Mai Hóa. Khi Mai Hóa từ báo động II (5,0m) trở lên, thêm hiệu chỉnh theo mực nước và cường suất lên, xuống của Mai Hóa. Sai số trung bình (kiểm chứng ngoài mẫu, mưa dự báo đúng): ngày thường khoảng 0,07 đến 0,08m, khi có lũ khoảng 0,12 đến 0,14m (mẫu lũ ít nên kém chắc chắn hơn); mưa dự báo sai thì kém hơn. Khi Tân Mỹ không có số liệu quan trắc, hệ thống tự chuyển sang phương án 2 (ước Tân Mỹ từ Đồng Hới và Mai Hóa), và nếu Đồng Hới cũng không có thì dùng phương án 3; sai số lớn hơn như đã nêu ở trên. Đây là thông tin tham khảo, không thay thế bản tin dự báo chính thức của Đài KTTV tỉnh Quảng Trị.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
