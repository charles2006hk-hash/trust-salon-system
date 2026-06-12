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
    totalRevenue: 0,   // 個人創造總營業額 (大數總和)
    totalCommission: 0, // 個人實得總抽成
    clientCount: 0,     // 服務總客數
    averageSpend: 0     // 平均客單價
  });

  // 🟢 參數大數拆解狀態
  const [categoryBreakdown, setCategoryBreakdown] = useState({});
  const [globalLabels, setGlobalLabels] = useState({});

  const DEFAULT_COMMISSION_RATE = 0.30; 

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            setCurrentUser({ uid: user.uid, ...userData });
            
            await initData(userData.name);
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

  // 🟢 初始化資料：抓取全域標籤、服務對照表，最後再抓業績
  const initData = async (staffName) => {
    try {
      // 1. 抓取 CMS 的自訂標籤 (W1, R1...)
      const settingSnap = await getDoc(doc(db, 'settings', 'global_config'));
      let labels = {};
      if (settingSnap.exists() && settingSnap.data().commissionLabels) {
          labels = settingSnap.data().commissionLabels;
      }
      setGlobalLabels(labels);

      // 2. 抓取 Services 和 Packages 來建立「服務名稱 -> 參數代碼」的對照字典
      const [svSnap, pkSnap] = await Promise.all([
          getDocs(collection(db, 'services')),
          getDocs(collection(db, 'packages'))
      ]);
      
      const serviceMap = {};
      svSnap.docs.forEach(d => { serviceMap[d.data().name] = d.data().commissionCode || 'W1' });
      pkSnap.docs.forEach(d => { serviceMap[d.data().name] = d.data().commissionCode || 'SCALP' });

      // 3. 開始結算個人業績
      await fetchMyTransactions(staffName, serviceMap);
    } catch (e) {
      console.error(e);
      toast.error("初始化資料失敗");
      setLoading(false);
    }
  };

  const fetchMyTransactions = async (staffName, serviceMap) => {
    try {
      if (!staffName) return;
      
      // 🟢 擴大抓取範圍，包含會員結帳、非會員現金、套票扣除與助手獎金
      const q = query(
        collection(db, 'transactions'), 
        where('type', 'in', ['deduct', 'walkin_cash', 'deduct_package', 'assistant_bonus'])
      );
      
      const snap = await getDocs(q);
      const matchedList = [];
      
      let revSum = 0;
      let commSum = 0;
      let clientCount = 0;
      let breakdown = {};

      snap.forEach(d => {
        const tx = d.data();
        if (tx.stylist && tx.stylist.includes(staffName)) {
          matchedList.push({ id: d.id, ...tx });
          
          const amount = Number(tx.amount || 0);
          revSum += amount;
          
          // 只針對有實際金額的單計算客數 (過濾掉純0元的紀錄)
          if (tx.type !== 'assistant_bonus' && tx.type !== 'deduct_package') {
             clientCount++;
          }
          
          // 計算抽成
          if (tx.type === 'assistant_bonus') {
             commSum += Number(tx.bonusAmount || 0);
          } else if (tx.commissionAmount) {
             commSum += Number(tx.commissionAmount);
          } else {
             commSum += (amount * DEFAULT_COMMISSION_RATE);
          }

          // 🟢 大數拆解邏輯
          let code = '未綁定參數';
          if (tx.type === 'assistant_bonus') {
             code = 'ASSISTANT_BONUS'; // 助手獎金獨立一區
          } else if (tx.service && serviceMap[tx.service]) {
             code = serviceMap[tx.service];
          }

          if (!breakdown[code]) breakdown[code] = 0;
          breakdown[code] += amount;
        }
      });

      matchedList.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      
      setMyTransactions(matchedList);
      setCategoryBreakdown(breakdown);
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

  if (loading) return <div className="p-10 text-[#D4AF37] bg-[#080808] min-h-screen font-bold tracking-widest text-sm">載入您的尊爵業績數據中...</div>;
  if (!currentUser) return <div className="p-10 text-red-500 bg-[#080808] min-h-screen">請先登入系統。</div>;

  return (
    <div className="p-6 md:p-10 pb-32 bg-[#080808] min-h-screen text-white font-sans selection:bg-[#D4AF37] selection:text-black">
      <Toaster position="top-right" />
      
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
            所屬店鋪：{currentUser.branch === 'ALL' ? '全域管理' : currentUser.branch || '未綁定'}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-[#D4AF37]/20 shadow-xl relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5 group-hover:scale-110 transition-transform">💰</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">本月實得提成 (分潤)</p>
          <p className="text-3xl font-black text-[#D4AF37] font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalCommission.toLocaleString()}</p>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">📈</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">創造總營業額 (總大數)</p>
          <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">👤</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">本月服務客數</p>
          <p className="text-3xl font-black text-white font-mono">{stats.clientCount} <span className="text-xs text-gray-500 font-normal">位</span></p>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">🎯</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">個人平均客單價</p>
          <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.averageSpend.toLocaleString()}</p>
        </div>
      </section>

      {/* 🟢 全新區塊：參數大數拆解 (Gross Revenue Breakdown) */}
      <section className="mb-10 animate-fade-in" style={{ animationDelay: '0.15s' }}>
         <h3 className="text-xs font-black tracking-widest uppercase text-white mb-4 border-l-4 border-[#D4AF37] pl-3">
           📊 各項服務大數拆解 (Gross Revenue Breakdown)
         </h3>
         <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.keys(categoryBreakdown).length === 0 ? (
               <div className="col-span-full bg-[#121212] p-6 rounded-2xl border border-dashed border-white/5 text-center text-gray-600 text-xs tracking-widest font-bold">目前尚無分類大數紀錄</div>
            ) : (
               Object.entries(categoryBreakdown)
                 .sort((a, b) => b[1] - a[1]) // 依金額由大到小排序
                 .map(([code, amount]) => (
                 <div key={code} className="bg-gradient-to-br from-[#1a1a1a] to-[#121212] p-5 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-colors shadow-lg relative overflow-hidden">
                    <div className="relative z-10">
                       <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 truncate">
                         {code === 'ASSISTANT_BONUS' ? '🤝 助手特別獎金' : code === '未綁定參數' ? '⚠️ 未綁定參數' : `${code} - ${globalLabels[code] || '未知標籤'}`}
                       </p>
                       <p className="text-xl font-black text-white font-mono tracking-tighter">
                         <span className="text-gray-500 text-sm mr-1">$</span>{amount.toLocaleString()}
                       </p>
                    </div>
                    {/* 背景裝飾 */}
                    <div className="absolute right-[-10px] bottom-[-10px] text-5xl opacity-[0.03] font-black italic">
                      {code.substring(0, 2)}
                    </div>
                 </div>
               ))
            )}
         </div>
      </section>

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
                <th className="p-5 font-bold">項目大數 (HKD)</th>
                <th className="p-5 font-bold text-right">預估個人分成</th>
              </tr>
            </thead>
            <tbody className="text-sm font-medium">
              {myTransactions.map(tx => {
                const amt = Number(tx.amount || 0);
                
                // 決定顯示的提成金額
                let comm = 0;
                if (tx.type === 'assistant_bonus') {
                   comm = Number(tx.bonusAmount || 0);
                } else if (tx.commissionAmount) {
                   comm = Number(tx.commissionAmount);
                } else {
                   comm = (amt * DEFAULT_COMMISSION_RATE);
                }
                
                return (
                  <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                    <td className="p-5 text-xs text-gray-400 font-mono">
                      {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '時間不詳'}
                    </td>
                    <td className="p-5">
                      <p className="text-white font-bold font-mono tracking-wider text-xs">
                        {tx.phoneNumber && tx.phoneNumber !== 'Walk-in (無提供電話)' 
                          ? (tx.phoneNumber.includes('+') ? tx.phoneNumber : `+852 ${tx.phoneNumber}`) 
                          : '現場散客 (Walk-in)'}
                      </p>
                    </td>
                    <td className="p-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-gray-200">
                          {tx.service || '未知項目'}
                        </span>
                        <div className="flex gap-2 items-center">
                          {tx.type === 'assistant_bonus' && <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 uppercase">助手獎金</span>}
                          {tx.type === 'deduct_package' && <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30 uppercase">扣抵套票 (-{tx.deductedGrids}格)</span>}
                        </div>
                      </div>
                    </td>
                    <td className="p-5 text-white font-bold font-mono">
                      ${amt.toLocaleString()}
                    </td>
                    <td className="p-5 text-[#D4AF37] font-black font-mono text-right">
                      ${Math.round(comm).toLocaleString()}
                    </td>
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
