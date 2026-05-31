"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth'; 
import { Toaster, toast } from 'react-hot-toast';

export default function StaffPerformancePage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myTransactions, setMyTransactions] = useState([]);
  
  // 🌟 統計數據狀態
  const [stats, setStats] = useState({
    totalRevenue: 0,   // 個人創造總營業額
    totalCommission: 0, // 個人實得總抽成
    clientCount: 0,     // 服務總客數
    averageSpend: 0     // 平均客單價
  });

  // 🟢 商業策略設定：店鋪預設抽成參數 (未來可以改為從員工個人檔案動態讀取)
  const DEFAULT_COMMISSION_RATE = 0.30; // 統一預設抽成 30% (老闆可自行修改此趴數)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // 1. 先抓取當前登入員工的 Firestore 個人檔案取得他的系統「顯示姓名」
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            setCurrentUser({ uid: user.uid, ...userData });
            
            // 2. 拿著他的名字，去撈取所有由他負責的交易明細
            await fetchMyTransactions(userData.name);
          } else {
            toast.error("找不到您的員工檔案，請聯繫老闆。");
            setLoading(false);
          }
        } catch (e) {
          console.error(e);
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // 🟢 核心安全邏輯：只撈取 stylist 欄位包含當前員工姓名的扣款結帳單 (type === 'deduct')
  const fetchMyTransactions = async (staffName) => {
    try {
      if (!staffName) return;
      
      const q = query(
        collection(db, 'transactions'), 
        where('type', '==', 'deduct')
      );
      
      const snap = await getDocs(q);
      const matchedList = [];
      
      let revSum = 0;
      let commSum = 0;
      let clientCount = 0;

      snap.forEach(d => {
        const tx = d.data();
        // 智慧識別：如果這條交易單的設計師名字和當前員工相符
        if (tx.stylist && tx.stylist.includes(staffName)) {
          matchedList.push({ id: d.id, ...tx });
          
          const amount = Number(tx.amount || 0);
          revSum += amount;
          clientCount++;
          
          // 🟢 提成計算公式：如果交易單本身有紀錄當次抽成金額就用交易單的，沒有就用店鋪預設趴數動態計算
          if (tx.commissionAmount) {
            commSum += Number(tx.commissionAmount);
          } else {
            commSum += (amount * DEFAULT_COMMISSION_RATE);
          }
        }
      });

      // 依照時間排序 (最新在最上面)
      matchedList.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      
      setMyTransactions(matchedList);
      setStats({
        totalRevenue: revSum,
        totalCommission: commSum,
        clientCount: clientCount,
        averageSpend: clientCount > 0 ? Math.round(revSum / clientCount) : 0
      });

    } catch (error) {
      console.error(error);
      toast.error("讀取業績報表失敗");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-10 text-[#D4AF37] bg-[#080808] min-h-screen">載入您的尊爵業績數據中...</div>;
  if (!currentUser) return <div className="p-10 text-red-500 bg-[#080808] min-h-screen">請先登入系統。</div>;

  return (
    <div className="p-6 md:p-10 pb-32 bg-[#080808] min-h-screen text-white font-sans selection:bg-[#D4AF37] selection:text-black">
      <Toaster position="top-right" />
      
      {/* 👑 頂部歡迎標題 */}
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 animate-fade-in">
        <div>
          <h1 className="text-3xl font-black text-white italic tracking-tighter mb-2">
            MY <span className="text-[#D4AF37]">PERFORMANCE</span>
          </h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold flex items-center gap-2">
            <span>設計師專屬業績與分成控制台</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-[#D4AF37] font-mono font-bold tracking-normal">Logged as: {currentUser.name} ({currentUser.role})</span>
          </p>
        </div>
        <div className="text-right">
          <span className="text-[9px] px-3 py-1.5 rounded-full font-bold tracking-widest uppercase bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
            所屬店鋪：{currentUser.branch === 'taipo' ? '大埔店' : currentUser.branch === 'lokfu' ? '樂富店' : '全域管理'}
          </span>
        </div>
      </header>

      {/* 💰 四大黃金業績指標卡 (激勵核心) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        
        {/* 指標 1: 實得總提成 (看得到的錢) */}
        <div className="bg-[#121212] p-6 rounded-[24px] border border-[#D4AF37]/20 shadow-xl relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5 group-hover:scale-110 transition-transform">💰</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">本月實得提成 (分潤)</p>
          <p className="text-3xl font-black text-[#D4AF37] font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalCommission.toLocaleString()}</p>
          <div className="mt-2 text-[9px] text-gray-500 flex items-center gap-1">
             <i className="fa-solid fa-circle-info"></i> 基於店鋪預設 {(DEFAULT_COMMISSION_RATE * 100)}% 抽成規則計算
          </div>
        </div>

        {/* 指標 2: 創造總業績 */}
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">📈</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">幫門市創造總營業額</p>
          <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalRevenue.toLocaleString()}</p>
          <div className="mt-2 text-[9px] text-green-400 font-bold uppercase tracking-wider">
             <i className="fa-solid fa-arrow-trend-up mr-1"></i>已計入店鋪月度總報表
          </div>
        </div>

        {/* 指標 3: 服務客數 */}
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">👤</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">本月累計服務客數</p>
          <p className="text-3xl font-black text-white font-mono">{stats.clientCount} <span className="text-xs text-gray-500 font-normal">位</span></p>
          <div className="mt-2 text-[9px] text-gray-500">包含指定預約與現場分單客戶</div>
        </div>

        {/* 指標 4: 平均客單價 */}
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">🎯</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">您的個人客單價 (單客貢獻)</p>
          <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.averageSpend.toLocaleString()}</p>
          <div className="mt-2 text-[9px] text-[#D4AF37] font-bold">
             🔥 數字越高代表增值、推銷能力越強！
          </div>
        </div>

      </section>

      {/* 📊 個人專屬消費服務明細表 */}
      <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl animate-fade-in" style={{ animationDelay: '0.2s' }}>
        <div className="p-6 border-b border-white/5 bg-black/20 flex justify-between items-center">
           <h3 className="text-sm font-black tracking-widest uppercase text-white"><i className="fa-solid fa-list-check mr-2 text-[#D4AF37]"></i> 本月服務流水對帳單</h3>
           <p className="text-[10px] text-gray-500 font-mono">共計 {myTransactions.length} 筆項目</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5 bg-black/40">
                <th className="p-5 font-bold">結帳日期 / 時間</th>
                <th className="p-5 font-bold">客戶識別號</th>
                <th className="p-5 font-bold">所做服務 / 項目內容</th>
                <th className="p-5 font-bold">單項消費金額</th>
                <th className="p-5 font-bold text-right">預估個人分成 (30%)</th>
              </tr>
            </thead>
            <tbody className="text-sm font-medium">
              {myTransactions.map(tx => {
                const amt = Number(tx.amount || 0);
                const comm = tx.commissionAmount ? Number(tx.commissionAmount) : (amt * DEFAULT_COMMISSION_RATE);
                
                return (
                  <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                    <td className="p-5 text-xs text-gray-400 font-mono">
                      {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '時間不詳'}
                    </td>
                    <td className="p-5">
                      <p className="text-white font-bold font-mono tracking-wider text-xs">
                        {tx.phoneNumber ? `+852 ${tx.phoneNumber}` : '現場散客 (Walk-in)'}
                      </p>
                    </td>
                    <td className="p-5">
                      <div className="flex flex-wrap gap-1">
                        {tx.items && tx.items.map((item, idx) => (
                          <span key={idx} className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded text-gray-300">
                            {item.name || item}
                          </span>
                        ))}
                        {tx.note && <p className="text-[10px] text-gray-500 w-full mt-1">備註: {tx.note}</p>}
                      </div>
                    </td>
                    <td className="p-5 text-white font-bold font-mono">${amt.toLocaleString()}</td>
                    <td className="p-5 text-[#D4AF37] font-black font-mono text-right">${Math.round(comm).toLocaleString()}</td>
                  </tr>
                );
              })}

              {myTransactions.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-20 text-center text-gray-600 font-bold tracking-widest border border-dashed border-white/5">
                    📭 您本月目前尚無結帳服務紀錄。新的一個月繼續加油！
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.5s ease-out both; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
