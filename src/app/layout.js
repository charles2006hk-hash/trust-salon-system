// src/app/layout.js
import './globals.css'; // 這是載入 Tailwind CSS 的關鍵！

export const metadata = {
  title: 'Trust Hair Salon | 會員系統',
  description: '大埔與樂富專業髮型屋會員系統',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-HK">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}