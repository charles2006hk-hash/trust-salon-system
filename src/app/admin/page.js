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
        router.push('/admin/login');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/admin/login');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">驗證安全權限中...</div>;
  if (!userData) return null;

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-8 font-sans selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 border-b border-white/5 pb-8 gap-6">
          <div>
            <h1 className="text-4xl font-black text-white italic tracking-tighter">TRUST <span className="text-[#D4AF37]">OS</span></h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] mt-2 font-bold">Salon Operating System</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Current User</p>
              <p className="text-sm font-bold text-white flex items-center justify-end gap-2">
                 {userData.name || userData.phoneNumber} 
                 <span className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-widest font-bold ${
                   userData.role === 'admin' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
                   userData.role === 'manager' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 
                   userData.role === 'reception' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 
                   'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                 }`}>
                   {userData.role}
                 </span>
              </p>
            </div>
            <button onClick={handleSignOut} className="w-12 h-12 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-500 text-gray-400 flex items-center justify-center transition-colors border border-white/10 hover:border-red-500/50">
              <i className="fa-solid fa-power-off"></i>
            </button>
          </div>
        </header>

        <h2 className="text-xs font-black text-gray-500 uppercase tracking-[0.3em] mb-8">選擇作業模組 (Modules)</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          
          {/* 模組 1：POS 收銀 (Admin, Manager, Reception, Staff 可見) */}
          {['admin', 'manager', 'reception', 'staff'].includes(userData.role) && (
            <div onClick={() => router.push('/admin/pos')} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:border-[#D4AF37]/50 cursor-pointer transition-all group shadow-xl flex flex-col justify-between h-full">
              <div>
                <div className="w-16 h-16 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <i className="fa-solid fa-cash-register text-2xl text-[#D4AF37]"></i>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">前台 POS 收銀</h3>
                <p className="text-xs text-gray-500 leading-relaxed">現場報到、服務派單、購物車結帳與客席增值售票。</p>
              </div>
            </div>
          )}

          {/* 模組 2：用戶與權限 (Admin, Manager, Reception 可見) */}
          {['admin', 'manager', 'reception'].includes(userData.role) && (
            <div onClick={() => router.push('/admin/users')} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:border-blue-500/50 cursor-pointer transition-all group shadow-xl flex flex-col justify-between h-full">
              <div>
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <i className="fa-solid fa-users-gear text-2xl text-blue-400"></i>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">用戶與權限管理</h3>
                <p className="text-xs text-gray-500 leading-relaxed">新增客戶檔案、管理員工系統權限，以及手動資產調整。</p>
              </div>
            </div>
          )}

          {/* 模組 3：CMS 管理 (Admin, Manager, Staff 可見 - 這裡修復了原先的重複代碼) */}
          {['admin', 'manager', 'staff'].includes(userData.role) && (
            <div onClick={() => router.push('/admin/manage')} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:border-white/30 cursor-pointer transition-all group shadow-xl flex flex-col justify-between h-full">
              <div>
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <i className="fa-solid fa-sliders text-2xl text-gray-300"></i>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">CMS 資料引擎</h3>
                <p className="text-xs text-gray-500 leading-relaxed">服務定價、髮型師設定、全局參數與官網行銷活動上架。</p>
              </div>
            </div>
          )}

          {/* 模組 4：我的業績與提成 (給 Admin, Manager, Staff 的個人激勵中心) */}
          {['admin', 'manager', 'staff'].includes(userData.role) && (
            <div onClick={() => router.push('/admin/my-performance')} className="bg-gradient-to-br from-[#1a1a1a] to-[#080808] p-8 rounded-[32px] border border-[#D4AF37]/30 hover:border-[#D4AF37] cursor-pointer transition-all group shadow-[0_0_30px_rgba(212,175,55,0.1)] relative overflow-hidden flex flex-col justify-between h-full">
              <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                <i className="fa-solid fa-hand-holding-dollar text-7xl text-[#D4AF37]"></i>
              </div>
              <div>
                <div className="w-16 h-16 rounded-2xl bg-[#D4AF37] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-lg relative z-10">
                  <i className="fa-solid fa-chart-simple text-2xl text-black"></i>
                </div>
                <h3 className="text-lg font-bold text-white mb-2 relative z-10">我的業績與提成</h3>
                <p className="text-xs text-gray-400 leading-relaxed relative z-10">
                  查看您專屬的當月服務客數、創造總營業額與實得抽成明細。
                </p>
              </div>
            </div>
          )}

          {/* 🟢 模組 5：全局審計日誌 (絕對機密：僅 Admin 可見) */}
          {userData.role === 'admin' && (
            <div onClick={() => router.push('/admin/system-logs')} className="bg-[#121212] p-8 rounded-[32px] border border-white/5 hover:border-purple-500/50 cursor-pointer transition-all group shadow-xl flex flex-col justify-between h-full">
              <div>
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <i className="fa-solid fa-user-shield text-2xl text-purple-400"></i>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">全局審計日誌</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  系統安全監控中心。追蹤所有單據修改、帳務異動與敏感操作軌跡。
                </p>
              </div>
            </div>
          )}

        </div>
        
        {/* 給純員工 (Staff) 的專屬問候語 */}
        {userData.role === 'staff' && (
           <div className="mt-12 text-center text-gray-600 font-bold tracking-widest text-sm border border-dashed border-white/5 py-10 rounded-[32px]">
             您目前使用的是員工帳號，僅開放查閱個人薪資與基礎店務模組。
           </div>
        )}
      </div>
    </div>
  );
}
