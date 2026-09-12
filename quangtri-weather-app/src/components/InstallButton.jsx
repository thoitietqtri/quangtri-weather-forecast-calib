import { useEffect, useState } from 'react';
import './InstallButton.css';

export default function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Đang chạy ở chế độ đã cài đặt (standalone) -> KHÔNG hiện gì cả, dù
    // trình duyệt có lỡ bắn sự kiện beforeinstallprompt cũng bỏ qua.
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // thuộc tính riêng của Safari iOS
    if (isStandalone) return;

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Sau khi cài xong (dù cài qua nút này hay qua menu trình duyệt) -> ẩn
    // vĩnh viễn, không cần đợi tải lại trang.
    const handleInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleInstalled);

    // iOS Safari không có beforeinstallprompt (Apple cố tình không hỗ trợ) —
    // hiện gợi ý cách làm thủ công thay vì im lặng không có gì.
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    if (iosDevice && isSafari) setIsIOS(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setVisible(false);
    setDeferredPrompt(null);
  };

  if (visible) {
    return (
      <button className="install-app-btn" onClick={handleInstallClick}>
        📲 Cài đặt ứng dụng
      </button>
    );
  }

  if (isIOS) {
    return (
      <div className="install-ios-hint">
        📲 Cài đặt: bấm <b>Chia sẻ</b> → <b>"Thêm vào MH chính"</b>
      </div>
    );
  }

  return null;
}
