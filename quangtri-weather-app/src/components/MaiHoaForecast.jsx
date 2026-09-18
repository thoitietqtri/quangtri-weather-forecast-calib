import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

export default function MaiHoaForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (asof, hs) => {
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (asof) params.set('asof', asof);
    if (hs) params.set('hesoHieuChinh', hs);
    fetch(`/.netlify/functions/forecast-maihoa?${params.toString()}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(null, heSo); }, []);

  return (
    <div className="maihoa-forecast-overlay" onClick={onClose}>
      <div className="maihoa-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="maihoa-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước Mai Hóa</h3>
            <div className="maihoa-forecast-wip">Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị</div>
          </div>
          <button className="maihoa-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="maihoa-forecast-body">
          <div className="dongtam-forecast-hesobox">
            <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ):</label>
            <div className="dongtam-forecast-hesobox-row">
              <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
              <button onClick={() => load(null, heSo)}>Áp dụng</button>
            </div>
          </div>

          {error && <div className="maihoa-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="maihoa-forecast-loading">⏳ Đang tải...</div>}
          {data && !data.available && <div className="maihoa-forecast-empty">ℹ️ {data.reason}</div>}

          {data && data.available && data.cheDo === 'ngay_thuong' && (
            <>
              <div className="dongtam-forecast-hiennay">
                Mai Hóa hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.maihoaHienTai}m</b>
                {' | '}Đồng Tâm: <b>{data.dongtamHienTai}m</b> (dưới ngưỡng lũ — dùng mô hình triều)
              </div>
              <div className="dongtam-forecast-dinh">
                🌊 Mai Hóa ước tính (ảnh hưởng triều): <b>{data.maihoaDuBao}m</b>
              </div>
              <div className="maihoa-forecast-inputs">
                <div className="maihoa-forecast-row"><span>Tân Mỹ (trễ 8h):</span><b>{data.tanmyLag8h}m</b></div>
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 24h qua:</span><b>{data.rainDaQua24h}mm</b></div>
              </div>
              <div className="maihoa-forecast-note">
                📊 Mô hình riêng cho ngày thường (không lũ) — dựa vào triều trạm Tân Mỹ (trễ 8h) + mực nước Đồng Tâm + mưa nhẹ, R²=0.56. Chỉ dùng khi Đồng Tâm dưới 5.6m — khi vượt mức này, hệ thống tự chuyển sang mô hình lũ (không dùng Tân Mỹ nữa, vì lũ phá vỡ quy luật triều).
              </div>
            </>
          )}

          {data && data.available && data.cheDo !== 'ngay_thuong' && (
            <>
              <div className="dongtam-forecast-hiennay">
                Mai Hóa hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.maihoaHienTai}m</b>
                {' | '}Đồng Tâm: <b>{data.dongtamHienTai}m</b>
                {' | '}Tân Lâm: <b>{data.tanlamHienTai}m</b>
              </div>

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
                hienTaiV={data.maihoaHienTai}
                duBaoTheoMoc={data.duBaoTheoMoc}
                nguong={{ bd1: 3, bd2: 5, bd3: 6.5 }}
              />

              <div className="dongtam-forecast-dinh">
                {data.nhanDinhDinh.coDinh ? (
                  <>🔴 Dự kiến đạt <b>ĐỈNH {data.nhanDinhDinh.giaTriDinh.toFixed(2)}m</b> trong khoảng {formatTimeVN(data.thoiDiemHienTai + data.nhanDinhDinh.gioTruoc * 3600000)} đến {formatTimeVN(data.thoiDiemHienTai + data.nhanDinhDinh.gioDinh * 3600000)}</>
                ) : data.nhanDinhDinh.dangTiepTucLen ? (
                  <>📈 Sau +24h vẫn còn xu hướng <b>TIẾP TỤC LÊN</b>, chưa xác định được đỉnh trong 24h tới</>
                ) : (
                  <>📉 Xu hướng giảm/ổn định trong 24h tới, không có đỉnh mới</>
                )}
              </div>

              <div className="maihoa-forecast-inputs">
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 24h đã qua:</span><b>{data.rainDaQua24h}mm</b></div>
                {[6, 12, 18, 24].map((h) => (
                  <div className="maihoa-forecast-row" key={h}>
                    <span>Mưa dự báo +{h}h (ECMWF→HC):</span>
                    <b>{data.mucMuaDuBao[h].goc}mm → {data.mucMuaDuBao[h].sauHieuChinh}mm</b>
                  </div>
                ))}
              </div>

              <div className="maihoa-forecast-note">
                📊 Phương trình riêng cho từng mốc, xây từ 212 mẫu giờ mùa lũ (2010-2025) — đạt chuẩn sai số ±1m: 91.5% (+6h), 76% (+12h), 74.5% (+18h), 81.6% (+24h).
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
