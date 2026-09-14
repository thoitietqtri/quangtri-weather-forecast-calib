import { useEffect, useState } from 'react';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export default function MaiHoaForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/.netlify/functions/forecast-maihoa')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="maihoa-forecast-overlay" onClick={onClose}>
      <div className="maihoa-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="maihoa-forecast-header">
          <h3>🔮 Dự báo đỉnh lũ Mai Hóa</h3>
          <button className="maihoa-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="maihoa-forecast-body">
          {error && <div className="maihoa-forecast-error">⚠️ Lỗi: {error}</div>}

          {!error && !data && <div className="maihoa-forecast-loading">⏳ Đang tải...</div>}

          {data && !data.available && (
            <div className="maihoa-forecast-empty">
              ℹ️ {data.reason}
              <p className="maihoa-forecast-hint">Dự báo chỉ xuất hiện khi Đồng Tâm vừa đạt đỉnh lũ được xác nhận (đã bắt đầu giảm ổn định).</p>
            </div>
          )}

          {data && data.available && (
            <>
              <div className="maihoa-forecast-main">
                <div className="maihoa-forecast-predicted">
                  <span className="label">Đỉnh Mai Hóa dự báo</span>
                  <span className="value">{data.predictedMaiHoaPeak}m</span>
                </div>
                <div className="maihoa-forecast-since">
                  Dựa vào đỉnh Đồng Tâm lúc {formatTimeVN(data.dongtamPeakTime)} ({data.hoursSincePeak}h trước)
                </div>
              </div>

              <div className="maihoa-forecast-inputs">
                <h4>Số liệu đầu vào:</h4>
                <div className="maihoa-forecast-row"><span>Đỉnh Đồng Tâm:</span><b>{data.dongtamPeakValue}m</b></div>
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 48h trước đỉnh:</span><b>{data.rain48h}mm</b></div>
                <div className="maihoa-forecast-row"><span>Tốc độ lên Đồng Tâm (24h trước đỉnh):</span><b>{data.riseRate24h}m/h</b></div>
              </div>

              <div className="maihoa-forecast-note">
                📊 Mô hình xây dựng từ 144 trận lũ lịch sử (2006-2025), kiểm định chéo R²=0.83, sai số trung bình ~0.6m.
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
