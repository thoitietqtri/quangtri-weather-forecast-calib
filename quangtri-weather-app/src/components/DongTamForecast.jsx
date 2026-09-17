import { useEffect, useState } from 'react';
import './DongTamForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
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
            <h3>🔮 Dự báo mực nước Đồng Tâm (24h tới)</h3>
            <div className="dongtam-forecast-wip">(Chức năng này chưa xong, đang trong giai đoạn xây dựng)</div>
          </div>
          <button className="dongtam-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="dongtam-forecast-body">
          <div className="dongtam-forecast-hesobox">
            <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ/đới gió đông kết hợp KKL, theo đánh giá chuyên môn):</label>
            <div className="dongtam-forecast-hesobox-row">
              <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
              <button onClick={() => load(heSo)}>Áp dụng</button>
            </div>
          </div>

          {error && <div className="dongtam-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="dongtam-forecast-loading">⏳ Đang tải...</div>}

          {data && !data.available && (
            <div className="dongtam-forecast-empty">ℹ️ {data.reason}</div>
          )}

          {data && data.available && (
            <>
              <div className="dongtam-forecast-main">
                <span className="label">Đồng Tâm dự báo lúc {formatTimeVN(data.thoiDiemHienTai + 24 * 3600000)} (24h tới)</span>
                <span className="value">{data.predictedDongTam24hToi}m</span>
              </div>

              <div className="dongtam-forecast-inputs">
                <div className="dongtam-forecast-row"><span>Mưa lưu vực 24h đã qua:</span><b>{data.rainDaQua24h}mm</b></div>
                <div className="dongtam-forecast-row"><span>Mưa dự báo ECMWF gốc (24h tới):</span><b>{data.rainDuBao24hGoc}mm</b></div>
                <div className="dongtam-forecast-row"><span>Sau hiệu chỉnh (×{data.heSoHieuChinh}):</span><b>{data.rainDuBao24hSauHieuChinh}mm</b></div>
              </div>

              <div className="dongtam-forecast-note">
                📊 Phương trình xây từ 144 trận lũ lịch sử, mô phỏng "mưa dự báo hoàn hảo" để kiểm tra khả năng dùng mưa dự báo — kiểm định chéo thực tế: đạt chuẩn sai số ±1m khoảng 58% (thấp hơn Mai Hóa, vì Đồng Tâm không có trạm nào phía trên để dùng mực nước, chỉ dựa vào mưa).
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên — đặc biệt lưu ý hệ số hiệu chỉnh mưa dự báo cần tự điều chỉnh theo tình huống thực tế.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
