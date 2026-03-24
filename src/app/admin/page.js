"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore'; 
import { auth, db } from '@/lib/firebase';

export default function AdminHub() {
  const router = useRouter();
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const docRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data();
            // 🟢 權限攔截：如果是普通客人，直接踢回前台
            if (!data.role || data.role === 'member') {
              alert("⚠️ 權限不足：您是普通會員，系統將自動跳轉至會員中心。");
              router.push('/dashboard');
              return;
            }
            setUserData(data);
          }
        } catch (error) {
          console.error("讀取權限失敗:", error);
        }
      } else {
        router.push('/login');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/login');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">驗證身分中...</div>;
  if (!userData) return null;

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-8 font-sans selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-end mb-16 border-b border-white/5 pb-8">
          <div>
            <h1 className="text-4xl font-black text-white italic tracking-tighter">TRUST <span className="text-[#D4AF37]">OS</span></h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] mt-2 font-bold">Salon Operating System</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Current User</p>
              <p className="text-sm font-bold text-white flex items-center justify-end gap-2">
                 {userData.phoneNumber} 
                 <span className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-widest ${userData.role === 'admin' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-400'}`}>
                   {userData.role}
                 </span>
              </p>
            </div>
            <button onClick={handleSignOut} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
              <i className="fa-solid fa-power-off text-gray-400"></i>
            </button>
          </div>
        </header>

        <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.3em] mb-8">選擇作業模組 (Modules)</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* 模組 1：POS 收銀 (Admin & Staff 可見) */}
          {(userData.role === 'admin' || userData.role === 'staff') && (
            <div onClick={() => router.push('/admin/pos')} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:border-[#D4AF37]/50 cursor-pointer transition-all group shadow-xl">
              <div className="w-16 h-16 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <i className="fa-solid fa-cash-register text-2xl text-[#D4AF37]"></i>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">前台 POS 系統</h3>
              <p className="text-xs text-gray-500 leading-relaxed">處理客人報到、現場排程調度、以及結帳扣款作業。</p>
            </div>
          )}

          {/* 模組 2：CMS 管理 (Admin & Staff 可見) */}
          {(userData.role === 'admin' || userData.role === 'staff') && (
            <div onClick={() => router.push('/admin/manage')} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:border-white/30 cursor-pointer transition-all group shadow-xl">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <i className="fa-solid fa-sliders text-2xl text-gray-300"></i>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">資料與 CMS 管理</h3>
              <p className="text-xs text-gray-500 leading-relaxed">管理服務定價、髮型師名單、官網優惠與積分商城上架。</p>
            </div>
          )}

          {/* 模組 3：財務報表 (僅 Admin 可見) 🔴 最高機密 */}
          {userData.role === 'admin' && (
            <div onClick={() => router.push('/admin/finance')} className="bg-gradient-to-br from-[#1a1a1a] to-[#080808] p-8 rounded-[32px] border border-[#D4AF37]/30 hover:border-[#D4AF37] cursor-pointer transition-all group shadow-[0_0_30px_rgba(212,175,55,0.1)] relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                <i className="fa-solid fa-chart-pie text-7xl text-[#D4AF37]"></i>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-[#D4AF37] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-lg relative z-10">
                <i className="fa-solid fa-chart-line text-2xl text-black"></i>
              </div>
              <h3 className="text-xl font-bold text-white mb-2 relative z-10">財務與業績分析</h3>
              <p className="text-xs text-gray-400 leading-relaxed relative z-10">老闆專屬：查看總營業額、未消耗負債、與髮型師抽成排行。</p>
            </div>
          )}

          {/* 模組 4：髮型師專區 (僅 Stylist 可見 - 預留未來開發) */}
          {userData.role === 'stylist' && (
            <div className="bg-[#121212] p-8 rounded-[32px] border border-blue-500/30 cursor-pointer transition-all group shadow-xl">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6">
                <i className="fa-solid fa-scissors text-2xl text-blue-400"></i>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">我的工作台</h3>
              <p className="text-xs text-gray-500 leading-relaxed">查看今日專屬預約名單與個人當月業績進度。</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
