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
  
  // 🟢 新增：統計類型切換與日期狀態
  const [filterType, setFilterType] = useState<'month' | 'day'>('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));  // YYYY-MM-DD
  
  const [serviceMapContext, setServiceMapContext] = useState({}); 

  const [targetStaff, setTargetStaff] = useState('');
  const [staffList, setStaffList] = useState([]);

  const [stats, setStats] = useState({
    totalRevenue: 0,   
    totalCommission: 0, 
    clientCount: 0,
    wrClientCount: 0,
    scalpClientCount: 0,
    productClientCount: 0,
    averageSpend: 0     
  });

  const [categoryBreakdown, setCategoryBreakdown] = useState({});
  const [globalLabels, setGlobalLabels] = useState({});
  const [myCommissionRules, setMyCommissionRules] = useState({});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            setCurrentUser({ uid: user.uid, ...userData });
            setTargetStaff(userData.name);

            if (userData.role === 'admin') {
               const staffQ = query(collection(db, 'users'), where('role', 'in', ['staff', 'manager', 'admin']));
               const staffSnap = await getDocs(staffQ);
               const names = staffSnap.docs.map(d => d.data().name).filter(Boolean);
               setStaffList([...new Set(names)]);
            }
            
            await initData();
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

  // 🟢 監聽：當過濾類型、日期、目標員工改變時，重新計算
  useEffect(() => {
    if (currentUser && targetStaff && Object.keys(serviceMapContext).length > 0) {
      fetchMyTransactions(targetStaff, serviceMapContext, filterType, selectedMonth, selectedDate);
    }
  }, [filterType, selectedMonth, selectedDate, targetStaff, serviceMapContext]);

  const initData = async () => {
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
    } catch (e) {
      console.error(e);
      toast.error("初始化資料失敗");
      setLoading(false);
    }
  };

  const fetchMyTransactions = async (staffName, serviceMap, currentFilterType, monthStr, dateStr) => {
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
      let breakdown = {};
      
      let uniqueClients = new Set();
      let uniqueWR = new Set();
      let uniqueScalp = new Set();
      let uniqueProduct = new Set();

      const staffConfigQ = query(collection(db, 'staff'), where('name', '==', staffName));
      const staffConfigSnap = await getDocs(staffConfigQ);
      let userCommissionsRule = {};
      
      if (!staffConfigSnap.empty) {
        userCommissionsRule = staffConfigSnap.docs[0].data().commissions || {};
      }
      setMyCommissionRules(userCommissionsRule);

      snap.forEach(d => {
        const tx = d.data();
        
        // 🟢 日期匹配邏輯：根據切換器決定比對「月份」還是「具體日期」
        let isMatchDate = false;
        if (currentFilterType === 'month') {
           const txMonth = tx.timestamp ? tx.timestamp.slice(0, 7) : '';
           isMatchDate = (txMonth === monthStr);
        } else {
           const txDay = tx.timestamp ? tx.timestamp.slice(0, 10) : '';
           isMatchDate = (txDay === dateStr);
        }

        if (tx.stylist && tx.stylist.includes(staffName) && isMatchDate) {
          matchedList.push({ id: d.id, ...tx });
          
          const amount = Number(tx.amount || 0);
          revSum += amount;

          let code = '未綁定參數';
          if (tx.type === 'assistant_bonus') {
             code = 'ASSISTANT_BONUS'; 
          } else if (tx.service && serviceMap[tx.service]) {
             code = serviceMap[tx.service];
          }
          
          if (tx.type === 'deduct' || tx.type === 'walkin_cash' || tx.type === 'deduct_package') {
             const ticketId = `${tx.timestamp}_${tx.phoneNumber || tx.id}`; 
             uniqueClients.add(ticketId);
             
             if (code.startsWith('W') || code.startsWith('R')) uniqueWR.add(ticketId);
             else if (code === 'SCALP') uniqueScalp.add(ticketId);
             else if (code.startsWith('P')) uniqueProduct.add(ticketId);
          }

          let calculatedComm = 0;
          if (tx.type === 'assistant_bonus') {
            calculatedComm = Number(tx.bonusAmount || 0);
          } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
            calculatedComm = Number(tx.commissionAmount);
          } else {
            const rule = userCommissionsRule[code];
            if (rule) {
              const deduct = Number(rule.deduct || 0);
              const percent = Number(rule.percent || 0);
              if (amount > deduct) {
                calculatedComm = (amount - deduct) * (percent / 100);
              }
            }
          }

          commSum += calculatedComm;

          if (!breakdown[code]) breakdown[code] = 0;
          breakdown[code] += amount;
        }
      });

      matchedList.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      
      setMyTransactions(matchedList);
      setCategoryBreakdown(breakdown);
      
      const safeRevSum = Math.round(revSum);
      const safeCommSum = Math.round(commSum);
      const finalClientCount = uniqueClients.size;

      setStats({
        totalRevenue: safeRevSum,
        totalCommission: safeCommSum,
        clientCount: finalClientCount,
        wrClientCount: uniqueWR.size,
        scalpClientCount: uniqueScalp.size,
        productClientCount: uniqueProduct.size,
        averageSpend: finalClientCount > 0 ? Math.round(safeRevSum / finalClientCount) : 0
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

  const isAdmin = currentUser.role === 'admin';
  const displayDateStr = filterType === 'month' ? selectedMonth : selectedDate;

  return (
    <div className="p-6 md:p-10 pb-32 bg-[#080808] min-h-screen text-white font-sans selection:bg-[#D4AF37] selection:text-black">
      <Toaster position="top-right" />
      
      <header className="mb-10 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 animate-fade-in">
        <div>
          <h1 className="text-3xl font-black text-white italic tracking-tighter mb-2">
            MY <span className="text-[#D4AF37]">PERFORMANCE</span>
          </h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold flex items-center gap-2">
            <span>設計師專屬業績與分成控制台</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-[#D4AF37] font-mono font-bold tracking-normal">
              Viewing: {targetStaff} {targetStaff === currentUser.name ? '(本人)' : ''}
            </span>
          </p>
        </div>
        
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          
          {isAdmin && staffList.length > 0 && (
            <div className="relative bg-gradient-to-r from-blue-900/20 to-black border border-blue-500/30 px-4 py-2 rounded-xl flex items-center gap-3 shadow-inner hover:border-blue-500 transition-colors focus-within:border-blue-500">
              <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest pointer-events-none">切換員工</span>
              <select 
                value={targetStaff}
                onChange={(e) => setTargetStaff(e.target.value)}
                className="bg-transparent text-white font-bold outline-none cursor-pointer text-sm appearance-none pr-4"
              >
                {staffList.map(name => <option key={name} value={name} className="bg-[#121212]">{name}</option>)}
              </select>
              <i className="fa-solid fa-chevron-down text-blue-500/50 absolute right-3 pointer-events-none text-xs"></i>
            </div>
          )}

          {/* 🟢 UI 修復：日統計 / 月統計 切換開關 */}
          <div className="flex bg-[#121212] p-1 rounded-xl border border-white/10 shadow-inner">
            <button 
              onClick={() => setFilterType('day')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${filterType === 'day' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              日統計
            </button>
            <button 
              onClick={() => setFilterType('month')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${filterType === 'month' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              月統計
            </button>
          </div>
          
          {/* 日期選擇器 */}
          <div className="relative bg-[#121212] border border-white/10 px-4 py-2 rounded-xl flex items-center gap-3 shadow-inner hover:border-[#D4AF37]/50 transition-colors focus-within:border-[#D4AF37]">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest pointer-events-none">
              {filterType === 'month' ? '結算月份' : '結算日期'}
            </span>
            {filterType === 'month' ? (
              <input 
                type="month" 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-[#D4AF37] font-bold outline-none cursor-pointer text-sm custom-month-input"
              />
            ) : (
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-[#D4AF37] font-bold outline-none cursor-pointer text-sm custom-month-input"
              />
            )}
          </div>

        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-[#D4AF37]/20 shadow-xl relative overflow-hidden group hover:border-[#D4AF37] transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5 group-hover:scale-110 transition-transform">💰</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">{displayDateStr} 實得提成</p>
            <p className="text-3xl font-black text-[#D4AF37] font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalCommission.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">📈</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">創造總營業額 (總大數)</p>
            <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.totalRevenue.toLocaleString()}</p>
          </div>
        </div>
        
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">👤</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">{displayDateStr} 服務總客數</p>
            <p className="text-3xl font-black text-white font-mono">{stats.clientCount} <span className="text-xs text-gray-500 font-normal">位</span></p>
          </div>
          <div className="flex gap-3 mt-3 pt-3 border-t border-white/10">
             <span className="text-[9px] text-gray-400">W/R: <span className="text-white font-bold">{stats.wrClientCount}</span></span>
             <span className="text-[9px] text-gray-400">Scalp: <span className="text-white font-bold">{stats.scalpClientCount}</span></span>
             <span className="text-[9px] text-gray-400">Prod: <span className="text-white font-bold">{stats.productClientCount}</span></span>
          </div>
        </div>

        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">🎯</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">個人平均客單價</p>
            <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{stats.averageSpend.toLocaleString()}</p>
          </div>
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
                 .sort((a, b) => Number(b[1]) - Number(a[1])) 
                 .map(([code, amount]) => (
                 <div key={code} className="bg-gradient-to-br from-[#1a1a1a] to-[#121212] p-5 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-colors shadow-lg relative overflow-hidden">
                    <div className="relative z-10">
                       <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 truncate">
                         {code === 'ASSISTANT_BONUS' ? '🤝 助手特別獎金' : code === '未綁定參數' ? '⚠️ 未綁定參數' : `${code} - ${globalLabels[code] || '未知標籤'}`}
                       </p>
                       <p className="text-xl font-black text-white font-mono tracking-tighter">
                         <span className="text-gray-500 text-sm mr-1">$</span>{Math.round(Number(amount)).toLocaleString()}
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
           <h3 className="text-sm font-black tracking-widest uppercase text-white"><i className="fa-solid fa-list-check mr-2 text-[#D4AF37]"></i> {displayDateStr} 服務流水對帳單</h3>
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
                     const rule = myCommissionRules[serviceMapContext[tx.service] || 'W1'];
                     if (rule && amt > Number(rule.deduct || 0)) {
                       comm = (amt - Number(rule.deduct || 0)) * (Number(rule.percent || 0) / 100);
                     }
                  }
                  
                  return (
                    <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                      <td className="p-5 text-xs text-gray-400 font-mono">
                        {tx.timestamp ? new Date(tx.timestamp).toLocaleString('zh-HK') : '時間不詳'}
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
                          {/* 🌟 核心修正：針對助手獎金強制顯示為「助手服務」 */}
                          <span className={`text-sm ${tx.type === 'assistant_bonus' ? 'text-[#D4AF37] font-bold' : 'text-gray-200'}`}>
                            {tx.type === 'assistant_bonus' ? '助手服務' : (tx.service || '未知項目')}
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
                      📭 {targetStaff} 在 {displayDateStr} 尚無結帳服務紀錄。
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
        ::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
        .custom-month-input { position: relative; }
        .custom-month-input::-webkit-calendar-picker-indicator { position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
      `}</style>
    </div>
  );
}
