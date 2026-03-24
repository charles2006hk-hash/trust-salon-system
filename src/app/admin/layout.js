"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore'; 
import { auth, db } from '@/lib/firebase';
import Link from 'next/link';

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname(); // 獲取當前網址
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 🟢 如果是登入頁面，不需要驗證權限，也不顯示側邊欄
    if (pathname === '/admin/login') {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const docRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data();
            // 阻擋普通客人
            if (!data.role || data.role === 'member') {
              alert("⚠️ 權限不足：系統將自動跳轉至會員中心。");
              router.push('/dashboard');
              return;
            }
            setUserData(data);
          }
        } catch (error) { console.error("讀取權限失敗:", error); }
      } else {
        router.push('/admin/login');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router, pathname]);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/admin/login');
  };

  // 登入頁面直接渲染，不加側邊欄
  if (pathname === '/admin/login') return children;
  
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">驗證身分中...</div>;
  if (!userData) return null;

  // 定義所有模組，並根據 role 決定是否顯示
  const menuItems = [
    { id: 'pos', name: '前台收銀 (POS)', icon: 'fa-cash-register', path: '/admin/pos', roles: ['admin', 'staff'] },
    { id: 'manage', name: '資料管理 (CMS)', icon: 'fa-sliders', path: '/admin/manage', roles: ['admin', 'staff'] },
    { id: 'finance', name: '財務報表', icon: 'fa-chart-pie', path: '/admin/finance', roles: ['admin'] },
    { id: 'users', name: '用戶與權限管理', icon: 'fa-users-gear', path: '/admin/users', roles: ['admin'] } // 🟢 新增的用戶管理模組
  ];

  return (
    <div className="flex h-screen bg-[#080808] font-sans selection:bg-[#D4AF37] selection:text-black overflow-hidden">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      
      {/* 🟢 左側固定導航欄 (Sidebar) */}
      <aside className="w-64 bg-[#121212] border-r border-white/5 flex flex-col hidden md:flex z-50">
        <div className="p-8 border-b border-white/5">
          <h1 className="text-2xl font-black text-white italic tracking-tighter">TRUST <span className="text-[#D4AF37]">OS</span></h1>
          <p className="text-[9px] text-gray-500 uppercase tracking-[0.3em] font-bold mt-1">{userData.role} Portal</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-4 mb-4 mt-4">Modules</p>
          {menuItems.map(item => {
            // 權限過濾
            if (!item.roles.includes(userData.role)) return null;
            
            const isActive = pathname.startsWith(item.path);
            return (
              <Link key={item.id} href={item.path} 
                className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all ${isActive ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
                <i className={`fa-solid ${item.icon} w-5 text-center ${isActive ? 'text-black' : 'text-[#D4AF37]'}`}></i>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-6 border-t border-white/5 bg-black/20">
          <div className="flex items-center gap-3 mb-4">
             <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white font-bold uppercase">
               {userData.email ? userData.email[0] : <i className="fa-solid fa-user"></i>}
             </div>
             <div className="overflow-hidden">
               <p className="text-xs font-bold text-white truncate">{userData.email || userData.phoneNumber}</p>
               <p className="text-[10px] text-[#D4AF37] uppercase tracking-widest">{userData.role}</p>
             </div>
          </div>
          <button onClick={handleSignOut} className="w-full py-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white text-xs font-bold transition flex items-center justify-center gap-2">
            <i className="fa-solid fa-power-off"></i> 登出系統
          </button>
        </div>
      </aside>

      {/* 🟢 右側動態內容區 */}
      <main className="flex-1 h-screen overflow-y-auto relative">
         {/* 手機版頂部導航 (簡易版) */}
         <div className="md:hidden bg-[#121212] p-4 flex justify-between items-center border-b border-white/5 sticky top-0 z-50">
            <h1 className="text-xl font-black text-white italic">TRUST <span className="text-[#D4AF37]">OS</span></h1>
            <button onClick={handleSignOut} className="text-red-500"><i className="fa-solid fa-power-off"></i></button>
         </div>
         {children}
      </main>
    </div>
  );
}
