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
  
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [serviceMapContext, setServiceMapContext] = useState({}); 

  const [stats, setStats] = useState({
    totalRevenue: 0,   
    totalCommission: 0, 
    clientCount: 0,     
    averageSpend: 0     
  });

  const [categoryBreakdown, setCategoryBreakdown] = useState({});
  const [globalLabels, setGlobalLabels] = useState({});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            setCurrentUser({ uid: user.uid, ...userData });
            await initData(userData.name, selectedMonth, userData);
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

  useEffect(() => {
    if (currentUser && Object.keys(serviceMapContext).length > 0) {
      fetchMyTransactions(currentUser.name, serviceMapContext, selectedMonth, currentUser);
    }
  }, [selectedMonth]);

  const initData = async (staffName, monthStr, userData) => {
    try {
      const settingSnap = await getDoc(doc(db, 'settings', 'global_config'));
      let labels = {};
      if (settingSnap.exists() && settingSnap.data().commissionLabels) {
          labels = settingSnap.data().commissionLabels;
      }
      setGlobalLabels(labels);

      const [svSnap, pkSnap] = await Promise.all([
          getDocs(collection(db, 'services')),
          getDocs(collection(db, 'packages'))
      ]);
      
      const serviceMap = {};
      svSnap.docs.forEach(d => { serviceMap[d.data().name] = d.data().commissionCode || 'W1' });
      pkSnap.docs.forEach(d => { serviceMap[d.data().name] = d.data().commissionCode || 'SCALP' });

      setServiceMapContext(serviceMap); 
      await fetchMyTransactions(staffName, serviceMap, monthStr, userData);
    } catch (e) {
      console.error(e);
      toast.error("初始化資料失敗");
      setLoading(false);
    }
  };

  const fetchMyTransactions = async (staffName, serviceMap, monthStr, userData) => {
    setLoading(true);
    try {
      if (!staffName) return;
      
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

      // 🟢 修正：去 staff 集合抓取 CMS 設定的抽成模板與參數
      const staffConfigQ = query(collection(db, 'staff'), where('name', '==', staffName));
      const staffConfigSnap = await getDocs(staffConfigQ);
      let userCommissionsRule = {};
      
      if (!staffConfigSnap.empty) {
        userCommissionsRule = staffConfigSnap.docs[0].data().commissions || {};
      }

      snap.forEach(d => {
        const tx = d.data();
        const txMonth = tx.timestamp ? tx.timestamp.slice(0, 7) : '';

        if (tx.stylist && tx.stylist.includes(staffName) && txMonth === monthStr) {
          matchedList.push({ id: d.id, ...tx });
          
          const amount = Number(tx.amount || 0);
          revSum += amount;
          
          if (tx.type !== 'assistant_bonus' && tx.type !== 'deduct_package') {
             clientCount++;
          }

          let code = '未綁定參數';
          if (tx.type === 'assistant_bonus') {
             code = 'ASSISTANT_BONUS'; 
          } else if (tx.service && serviceMap[tx.service]) {
             code = serviceMap[tx.service];
          }

          let calculatedComm = 0;
          if (tx.type === 'assistant_bonus') {
            calculatedComm = Number(tx.bonusAmount || 0);
          } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
            calculatedComm = Number(tx.commissionAmount);
          } else {
            // 🟢 使用從 staff 集合抓到的規則進行計算
            const rule = userCommissionsRule[code] || null;
            if (rule) {
              const deduct = Number(rule.deduct || 0);
              const percent = Number(rule.percent || 0);
              if (amount > deduct) {
                // 處理浮點數精度
                calculatedComm = (amount - deduct) * (percent / 100);
              }
            }
          }

          commSum += calculatedComm;

          if (!breakdown[code]) breakdown[code] = 0;
          breakdown[code] += amount;
        }
      });

      matchedList.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      
      setMyTransactions(matchedList);
      setCategoryBreakdown(breakdown);
      
      const safeRevSum = Math.round(revSum);
      const safeCommSum = Math.round(commSum);

      setStats({
        totalRevenue: safeRevSum,
        totalCommission: safeCommSum,
        clientCount: clientCount,
        averageSpend: clientCount > 0 ? Math.round(safeRevSum / clientCount) : 0
      });

    } catch (error) {
      console.error(error);
      toast.error("讀取業績報表失敗");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !currentUser) return <div className="p-10 text-[#D4AF37] bg-[#080808] min-h-screen font-bold tracking-widest text-sm">載入您的尊爵業績數據中...</div>;
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
        
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2 bg-[#121212] border border-white/10 p-1.5 rounded-2xl">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-3">結算月份</span>
            <input 
              type="month" 
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-black text-[#D4AF37] border border-[#D4AF37]/30 px-4 py-2 rounded-xl text-sm font-bold outline-none cursor-pointer custom-month-picker"
            />
          </div>
          <span className="text-[9px] px-3 py-1.5 rounded-full font-bold tracking-widest uppercase bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30">
            所屬店鋪：{currentUser.branch === 'ALL' ? '全域管理' : currentUser.branch || '未綁定'}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-[#D4AF37]/20 shadow-xl relative overflow-hidden group hover:border-[#D4AF37] transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5 group-hover:scale-110 transition-transform">💰</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">{selectedMonth} 實得提成</p>
          <p className="text-3xl font-black text-[#D4AF37] font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalCommission.toLocaleString()}</p>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">📈</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">創造總營業額 (總大數)</p>
          <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">👤</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">{selectedMonth} 服務客數</p>
          <p className="text-3xl font-black text-white font-mono">{stats.clientCount} <span className="text-xs text-gray-500 font-normal">位</span></p>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">🎯</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">個人平均客單價</p>
          <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.averageSpend.toLocaleString()}</p>
        </div>
      </section>

      <section className="mb-10 animate-fade-in" style={{ animationDelay: '0.15s' }}>
         <h3 className="text-xs font-black tracking-widest uppercase text-white mb-4 border-l-4 border-[#D4AF37] pl-3">
           📊 各項服務大數拆解 (Gross Revenue Breakdown)
         </h3>
         <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.keys(categoryBreakdown).length === 0 ? (
               <div className="col-span-full bg-[#121212] p-6 rounded-2xl border border-dashed border-white/5 text-center text-gray-600 text-xs tracking-widest font-bold">目前尚無分類大數紀錄</div>
            ) : (
               Object.entries(categoryBreakdown)
                 .sort((a, b) => b[1] - a[1]) 
                 .map(([code, amount]) => (
                 <div key={code} className="bg-gradient-to-br from-[#1a1a1a] to-[#121212] p-5 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-colors shadow-lg relative overflow-hidden">
                    <div className="relative z-10">
                       <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 truncate">
                         {code === 'ASSISTANT_BONUS' ? '🤝 助手特別獎金' : code === '未綁定參數' ? '⚠️ 未綁定參數' : `${code} - ${globalLabels[code] || '未知標籤'}`}
                       </p>
                       <p className="text-xl font-black text-white font-mono tracking-tighter">
                         <span className="text-gray-500 text-sm mr-1">$</span>{Math.round(amount).toLocaleString()}
                       </p>
                    </div>
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
           <h3 className="text-sm font-black tracking-widest uppercase text-white"><i className="fa-solid fa-list-check mr-2 text-[#D4AF37]"></i> {selectedMonth} 服務流水對帳單</h3>
           <p className="text-[10px] text-gray-500 font-mono">共計 {myTransactions.length} 筆項目</p>
        </div>

        {loading && myTransactions.length === 0 ? (
          <div className="text-center py-10 text-[#D4AF37] text-xs font-bold tracking-widest">
            <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>結算中...
          </div>
        ) : (
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
                  
                  let comm = 0;
                  if (tx.type === 'assistant_bonus') {
                     comm = Number(tx.bonusAmount || 0);
                  } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
                     comm = Number(tx.commissionAmount);
                  } else {
                     const rule = currentUser?.commissions?.[serviceMapContext[tx.service] || 'W1'] || { deduct: 0, percent: 30 };
                     if (amt > rule.deduct) {
                       comm = (amt - rule.deduct) * (rule.percent / 100);
                     }
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
                        ${Math.round(amt).toLocaleString()}
                      </td>
                      <td className="p-5 text-[#D4AF37] font-black font-mono text-right">
                        ${Math.round(comm).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}

                {myTransactions.length === 0 && !loading && (
                  <tr>
                    <td colSpan="5" className="p-20 text-center text-gray-600 font-bold tracking-widest border border-dashed border-white/5">
                      📭 您在 {selectedMonth} 尚無結帳服務紀錄。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.5s ease-out both; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        ::-webkit-calendar-picker-indicator {
            filter: invert(1);
            cursor: pointer;
        }
      `}</style>
    </div>
  );
}
