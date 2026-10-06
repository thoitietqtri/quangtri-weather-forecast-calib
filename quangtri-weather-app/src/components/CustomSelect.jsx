import { useEffect, useRef, useState } from 'react';
import './CustomSelect.css';

// Dropdown tự thiết kế — thay cho thẻ <select> gốc (phụ thuộc giao diện hệ
// điều hành Android/trình duyệt, có thể đổi hành vi ngoài ý muốn, ví dụ tự
// thêm nút "Hoàn tất" sau khi cập nhật WebView). Dùng hoàn toàn bằng
// React + div, bấm chọn là đóng ngay, không qua bước xác nhận nào.
//
// props:
//   value: giá trị đang chọn
//   onChange: (value) => void
//   options: [{ value, label }, ...]
//   placeholder: chữ hiện khi chưa chọn gì (value === '')
export default function CustomSelect({ value, onChange, options, placeholder = '-- Chọn --' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function dongKhiBamNgoai(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', dongKhiBamNgoai);
    document.addEventListener('touchstart', dongKhiBamNgoai);
    return () => {
      document.removeEventListener('mousedown', dongKhiBamNgoai);
      document.removeEventListener('touchstart', dongKhiBamNgoai);
    };
  }, []);

  const hienTai = options.find((o) => o.value === value);

  return (
    <div className="custom-select-wrap" ref={wrapRef}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="custom-select-trigger-text">{hienTai ? hienTai.label : placeholder}</span>
        <span className="custom-select-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="custom-select-list">
          {options.map((o) => (
            <div
              key={o.value}
              className={`custom-select-option${o.value === value ? ' custom-select-option--chon' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
