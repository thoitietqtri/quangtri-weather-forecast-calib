import { useEffect, useState } from 'react';
import './VisitCounter.css';

// Gọi 1 lần khi component được gắn (mount) — tức đúng 1 lần mỗi lần tải
// trang, không gọi lại khi người dùng chỉ chọn xã/ngày khác trong app.
export default function VisitCounter() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/.netlify/functions/visit-counter')
      .then((r) => r.json())
      .then((d) => { if (d && d.total != null) setData(d); })
      .catch(() => {}); // lỗi đếm không ảnh hưởng gì đến trải nghiệm chính của app
  }, []);

  if (!data) return null; // chưa tải xong hoặc lỗi -> không hiện gì, không làm phiền người dùng

  const fmt = (n) => n.toLocaleString('vi-VN');

  return (
    <div className="visit-counter" title="Thống kê lượt truy cập">
      👁️ Hôm nay: {fmt(data.today)} · Hôm qua: {fmt(data.yesterday)} · Tháng: {fmt(data.month)} · Năm: {fmt(data.year)} · Tổng: {fmt(data.total)}
    </div>
  );
}
