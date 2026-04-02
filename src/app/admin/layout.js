"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore'; 
import { auth, db } from '@/lib/firebase';
import Link from 'next/link';

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname(); 
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // ==========================================
  // 👑 系統權限與模組定義區 (Role & Module Config)
  // ==========================================
  const ALL_MODULES = [
    { id: 'pos', name: '前台收銀 (POS)', icon: 'fa-cash-register', path: '/admin/pos' },
    { id: 'manage', name: '資料管理 (CMS)', icon: 'fa-sliders', path: '/admin/manage' },
    { id: 'finance', name: '財務報表', icon: 'fa-chart-pie', path: '/admin/finance' },
    { id: 'users', name: '用戶與權限', icon: 'fa-users-gear', path: '/admin/users' }
  ];

  // 🟢 更新：開放 users 模組給經理與櫃台
  const ROLE_PERMISSIONS = {
    admin: ['pos', 'manage', 'finance', 'users'], // 老闆：全開
    manager: ['pos', 'manage', 'finance', 'users'], // 經理：全開 (但在 users 頁面會限制刪除權限)
    staff: ['pos', 'manage'],                     // 員工：結帳、修改商品庫
    reception: ['pos', 'users']                   // 櫃台：結帳、管理客入檔案
  };
  // ==========================================

  useEffect(() => {
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
            if (!data.role || data.role === 'member') {
              router.push('/dashboard');
              return;
            }
            if (!ROLE_PERMISSIONS[data.role]) {
              data.role = 'reception'; 
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

  if (pathname === '/admin/login') return children;
  
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">驗證系統權限中...</div>;
  if (!userData) return null;

  const allowedModuleIds = ROLE_PERMISSIONS[userData.role] || [];
  const allowedModules = ALL_MODULES.filter(module => allowedModuleIds.includes(module.id));
  const allowedPaths = allowedModules.map(m => m.path);

  if (pathname === '/admin') {
    router.replace(allowedPaths[0] || '/dashboard');
    return null;
  }

  const hasPermission = allowedPaths.some(path => pathname.startsWith(path));
  
  if (!hasPermission) {
    setTimeout(() => { router.replace(allowedPaths[0] || '/dashboard'); }, 1500);
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080808] text-red-500 flex-col space-y-4">
        <i className="fa-solid fa-shield-halved text-6xl mb-2 opacity-80"></i>
        <h1 className="text-3xl font-black tracking-widest uppercase">Access Denied</h1>
        <p className="text-gray-500 text-xs tracking-[0.3em] font-bold">權限不足，系統正在攔截並重新導向...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#080808] font-sans selection:bg-[#D4AF37] selection:text-black overflow-hidden relative">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm transition-opacity" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#121212] border-r border-white/5 flex flex-col transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-300 ease-in-out shadow-2xl md:shadow-none`}>
        <button onClick={() => setIsSidebarOpen(false)} className="md:hidden absolute top-6 right-6 text-gray-400 hover:text-white">
           <i className="fa-solid fa-xmark text-xl"></i>
        </button>

        <div className="p-8 border-b border-white/5 flex items-center justify-center">
          {/* 🟢 這裡已經替換為你的新 Logo */}
          <img src="/images/logo-royal.svg" alt="TRUST OS Logo" className="h-10 w-auto" />
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
          <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-4 mb-4 mt-4">Modules</p>
          
          {allowedModules.map(item => {
            const isActive = pathname.startsWith(item.path);
            return (
              <Link key={item.id} href={item.path} onClick={() => setIsSidebarOpen(false)}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all ${isActive ? 'bg-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
                <i className={`fa-solid ${item.icon} w-5 text-center ${isActive ? 'text-black' : 'text-[#D4AF37]'}`}></i>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-6 border-t border-white/5 bg-black/20">
          <div className="flex items-center gap-3 mb-4">
             <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white font-bold uppercase shrink-0">
               {userData.email ? userData.email[0] : <i className="fa-solid fa-user"></i>}
             </div>
             <div className="overflow-hidden">
               <p className="text-xs font-bold text-white truncate">{userData.email || userData.phoneNumber || 'User'}</p>
               <p className="text-[10px] text-gray-500 uppercase tracking-widest truncate">{userData.role}</p>
             </div>
          </div>
          <button onClick={handleSignOut} className="w-full py-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white text-xs font-bold transition flex items-center justify-center gap-2">
            <i className="fa-solid fa-power-off"></i> 登出系統
          </button>
        </div>
      </aside>

      <main className="flex-1 h-screen overflow-y-auto relative bg-[#080808]">
         <div className="md:hidden bg-[#121212]/90 backdrop-blur-md p-5 flex justify-between items-center border-b border-white/5 sticky top-0 z-30">
            <div className="flex items-center gap-4">
              <button onClick={() => setIsSidebarOpen(true)} className="text-gray-400 hover:text-white text-xl">
                <i className="fa-solid fa-bars"></i>
              </button>
              <img src="/images/logo-royal.svg" alt="TRUST OS Logo" className="h-6 w-auto" />
            </div>
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-white font-bold uppercase">
               {userData.role.substring(0, 1)}
            </div>
         </div>
         {children}
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
      `}</style>
    </div>
  );
}
