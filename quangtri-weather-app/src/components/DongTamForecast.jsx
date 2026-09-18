import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './DongTamForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

export default function DongTamForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (hs) => {
    setData(null);
    setError(null);
    fetch(`/.netlify/functions/forecast-dongtam?hesoHieuChinh=${encodeURIComponent(hs)}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(heSo); }, []);

  return (
    <div className="dongtam-forecast-overlay" onClick={onClose}>
      <div className="dongtam-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dongtam-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước Đồng Tâm</h3>
            <div className="dongtam-forecast-wip">(Chức năng này chưa xong, đang trong giai đoạn xây dựng)</div>
          </div>
          <button className="dongtam-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="dongtam-forecast-body">
          <div className="dongtam-forecast-hesobox">
            <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ/đới gió đông kết hợp KKL):</label>
            <div className="dongtam-forecast-hesobox-row">
              <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
              <button onClick={() => load(heSo)}>Áp dụng</button>
            </div>
          </div>

          {error && <div className="dongtam-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="dongtam-forecast-loading">⏳ Đang tải...</div>}
          {data && !data.available && <div className="dongtam-forecast-empty">ℹ️ {data.reason}</div>}

          {data && data.available && (
            <>
              <div className="dongtam-forecast-hiennay">
                Đồng Tâm hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.dongtamHienTai}m</b>
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
                hienTaiV={data.dongtamHienTai}
                duBaoTheoMoc={data.duBaoTheoMoc}
                nguong={{ bd1: 7, bd2: 13, bd3: 16 }}
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

              <div className="dongtam-forecast-inputs">
                <div className="dongtam-forecast-row"><span>Mưa lưu vực 24h đã qua:</span><b>{data.rainDaQua24h}mm</b></div>
                <div className="dongtam-forecast-row"><span>Tốc độ lên/xuống (6h qua):</span><b>{data.tocDo6h}m/h</b></div>
                {[6, 12, 18, 24].map((h) => (
                  <div className="dongtam-forecast-row" key={h}>
                    <span>Mưa dự báo +{h}h (ECMWF→HC):</span>
                    <b>{data.mucMuaDuBao[h].goc}mm → {data.mucMuaDuBao[h].sauHieuChinh}mm</b>
                  </div>
                ))}
              </div>

              <div className="dongtam-forecast-note">
                📊 Phương trình riêng cho từng mốc, xây từ 332 mẫu giờ mùa lũ (2006-2025) — đạt chuẩn sai số ±1m: 74.7% (+6h), 68.4% (+12h), 71.1% (+18h), 75.9% (+24h).
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
