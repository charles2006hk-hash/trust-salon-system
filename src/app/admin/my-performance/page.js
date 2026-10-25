"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth'; 
import { Toaster, toast } from 'react-hot-toast';

import { calculateStaffCommissions } from '@/lib/finance'; 

const PREFERRED_ORDER = ['R1', 'R2', 'R3', 'R4', 'R5', 'W1', 'W2', 'W3', 'W4', 'W5', 'P1', 'P2', 'P3', 'P4', 'P5', 'SCALP', 'SCALP_PROD'];

export default function StaffPerformancePage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [filterType, setFilterType] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));  
  
  const [serviceMapContext, setServiceMapContext] = useState({}); 
  const [targetStaff, setTargetStaff] = useState('');
  const [staffList, setStaffList] = useState([]);

  const [myTransactions, setMyTransactions] = useState([]);
  const [detailedBreakdown, setDetailedBreakdown] = useState({});

  const [stats, setStats] = useState({ 
    totalRevenue: 0, 
    totalCommission: 0, 
    clientCount: 0, 
    wrClientCount: 0, 
    scalpClientCount: 0, 
    productClientCount: 0, 
    averageSpend: 0 
  });
  
  const [dynamicTierStats, setDynamicTierStats] = useState({ 
    realScalpClientCount: 0, 
    combinedRevenue: 0, 
    finalScalpPct: 25, 
    finalProdPct: 20,
    triggerAccumulatedAmount: 0,
    isBonusTierAchieved: false,
    bonusTierThreshold: 0
  });
  
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
      
      // 🚀 核心優化：加入資料庫層級的日期區間過濾，徹底解決讀取量爆炸的問題
      let startTime, endTime;
      if (currentFilterType === 'month') {
        startTime = `${monthStr}-01T00:00:00`;
        endTime = `${monthStr}-31T23:59:59`;
      } else {
        startTime = `${dateStr}T00:00:00`;
        endTime = `${dateStr}T23:59:59`;
      }

      // 僅向資料庫要求該日期區間的資料
      const q = query(
        collection(db, 'transactions'), 
        where("timestamp", ">=", startTime),
        where("timestamp", "<=", endTime)
      );
      
      const snap = await getDocs(q);
      const targetTxs = [];
      const validTypes = ['deduct', 'walkin_cash', 'deduct_package', 'assistant_bonus', 'member_cash'];

      snap.forEach(d => {
        const tx = d.data();
        
        // 在前端過濾我們需要的交易類型 (避免複合索引出錯)
        if (!validTypes.includes(tx.type)) return;

        const stylistArray = tx.stylist ? tx.stylist.split(',').map(s => s.trim()) : [];
        if (stylistArray.includes(staffName)) {
           targetTxs.push({ id: d.id, ...tx });
        }
      });

      const staffConfigQ = query(collection(db, 'staff'), where('name', '==', staffName));
      const staffConfigSnap = await getDocs(staffConfigQ);
      let userCommissionsRule = {};
      if (!staffConfigSnap.empty) {
        userCommissionsRule = staffConfigSnap.docs[0].data().commissions || {};
      }
      setMyCommissionRules(userCommissionsRule);

      const result = calculateStaffCommissions(
        targetTxs, 
        userCommissionsRule, 
        serviceMap, 
        globalLabels
      );

      setMyTransactions(result.processedTransactions || []);
      
      setDynamicTierStats(result.dynamicTierStats || { 
        realScalpClientCount: 0, 
        combinedRevenue: 0, 
        finalScalpPct: 25, 
        finalProdPct: 20,
        triggerAccumulatedAmount: 0,
        isBonusTierAchieved: false,
        bonusTierThreshold: 0
      });
      
      setStats(result.stats || { totalRevenue: 0, totalCommission: 0, clientCount: 0, wrClientCount: 0, scalpClientCount: 0, productClientCount: 0, averageSpend: 0 });

      const breakdown = {};
      
      const isAddonService = (serviceName = '') => {
        const sName = serviceName.toUpperCase();
        return sName.includes('加') || 
               sName.includes('追加') || 
               sName.includes('ADD-ON') || 
               sName.includes('ADD ON') || 
               sName.includes('升級') || 
               sName.includes('UPGRADE');
      };

      (result.processedTransactions || []).forEach(tx => {
         const code = tx.computedCode || '未綁定參數';
         const amt = Number(tx.amount || 0);

         if (!breakdown[code]) {
           breakdown[code] = { amount: 0, count: 0 };
         }
         
         breakdown[code].amount += amt;
         
         if (!isAddonService(tx.service)) {
           breakdown[code].count += 1;
         }
      });

      setDetailedBreakdown(breakdown);

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

      {dynamicTierStats.bonusTierThreshold > 0 && filterType === 'month' && (
        <section className="mb-4 animate-fade-in bg-gradient-to-br from-indigo-900/30 to-[#121212] border border-indigo-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-3xl rounded-full"></div>
          <h3 className="text-sm font-black text-indigo-400 mb-3 flex items-center gap-2">
            <i className="fa-solid fa-bolt-lightning"></i> 當月自訂階梯觸發狀態
            {dynamicTierStats.isBonusTierAchieved ? (
              <span className="bg-green-500 text-black text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ml-2 tracking-widest">已達標解鎖</span>
            ) : (
              <span className="bg-orange-500 text-black text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ml-2 tracking-widest">努力中</span>
            )}
          </h3>
          
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="flex-1 w-full">
              <div className="flex justify-between text-[10px] text-gray-400 uppercase tracking-widest mb-2 font-bold">
                <span>觸發項目累積金額</span>
                <span>目標: ${dynamicTierStats.bonusTierThreshold.toLocaleString()}</span>
              </div>
              <div className="w-full bg-black rounded-full h-3 border border-white/10 overflow-hidden">
                <div className={`h-full transition-all duration-1000 ${dynamicTierStats.isBonusTierAchieved ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min((dynamicTierStats.triggerAccumulatedAmount / dynamicTierStats.bonusTierThreshold) * 100, 100)}%` }}></div>
              </div>
            </div>
            
            <div className="shrink-0 text-right">
               <p className={`text-2xl font-black font-mono ${dynamicTierStats.isBonusTierAchieved ? 'text-green-400' : 'text-indigo-400'}`}>
                 ${(dynamicTierStats.triggerAccumulatedAmount || 0).toLocaleString()}
               </p>
               {!dynamicTierStats.isBonusTierAchieved && (
                 <p className="text-[10px] text-gray-500 font-bold mt-1">
                   還差 ${(dynamicTierStats.bonusTierThreshold - dynamicTierStats.triggerAccumulatedAmount).toLocaleString()} 達標
                 </p>
               )}
            </div>
          </div>
        </section>
      )}

      <section className="mb-6 animate-fade-in bg-gradient-to-br from-green-900/30 to-[#121212] border border-green-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 blur-3xl rounded-full"></div>
        <h3 className="text-sm font-black text-green-400 mb-3 flex items-center gap-2">
          <i className="fa-solid fa-leaf"></i> 專屬頭皮/養護階梯獎勵狀態
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
           <div>
             <p className="text-[10px] text-gray-400 uppercase tracking-widest">真實套票客量</p>
             <p className="text-xl font-bold font-mono text-white">{dynamicTierStats.realScalpClientCount || 0} <span className="text-xs font-normal text-gray-500">位</span></p>
             <p className="text-[10px] text-green-500 font-bold mt-1">
               {dynamicTierStats.realScalpClientCount >= 2 
                 ? '✅ 產品提成加碼 +5%' 
                 : '距產品提成升級差 ' + (2 - (dynamicTierStats.realScalpClientCount || 0)) + ' 位'}
             </p>
           </div>
           <div>
             <p className="text-[10px] text-gray-400 uppercase tracking-widest">頭皮總業績 (套票+產品)</p>
             <p className="text-xl font-bold font-mono text-white"><span className="text-xs text-gray-500">$</span>{(dynamicTierStats.combinedRevenue || 0).toLocaleString()}</p>
             <p className="text-[10px] text-green-500 font-bold mt-1">
               距離下次總達標 (+5%) 還差 ${(10000 - ((dynamicTierStats.combinedRevenue || 0) % 10000)).toLocaleString()}
             </p>
           </div>
           <div className="bg-black/40 p-2 rounded-lg border border-white/5 text-center">
             <p className="text-[10px] text-gray-500 uppercase">當前套票結算 %</p>
             <p className="text-2xl font-black text-[#D4AF37] font-mono">{dynamicTierStats.finalScalpPct || 25}%</p>
           </div>
           <div className="bg-black/40 p-2 rounded-lg border border-white/5 text-center">
             <p className="text-[10px] text-gray-500 uppercase">當前產品結算 %</p>
             <p className="text-2xl font-black text-[#D4AF37] font-mono">{dynamicTierStats.finalProdPct || 20}%</p>
           </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-[#D4AF37]/20 shadow-xl relative overflow-hidden group hover:border-[#D4AF37] transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5 group-hover:scale-110 transition-transform">💰</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">{displayDateStr} 實得提成</p>
            <p className="text-3xl font-black text-[#D4AF37] font-mono"><span className="text-sm mr-0.5">$</span>{(stats.totalCommission || 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">📈</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">創造總營業額 (總大數)</p>
            <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{(stats.totalRevenue || 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">👤</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">{displayDateStr} 服務總客數</p>
            <p className="text-3xl font-black text-white font-mono">{stats.clientCount || 0} <span className="text-xs text-gray-500 font-normal">位</span></p>
          </div>
          <div className="flex gap-3 mt-3 pt-3 border-t border-white/10">
             <span className="text-[9px] text-gray-400">W/R: <span className="text-white font-bold">{stats.wrClientCount || 0}</span></span>
             <span className="text-[9px] text-gray-400">Scalp: <span className="text-white font-bold">{stats.scalpClientCount || 0}</span></span>
             <span className="text-[9px] text-gray-400">Prod: <span className="text-white font-bold">{stats.productClientCount || 0}</span></span>
          </div>
        </div>
        <div className="bg-[#121212] p-6 rounded-[24px] border border-white/5 shadow-xl relative overflow-hidden group hover:border-white/10 transition-all flex flex-col justify-between">
          <div className="absolute -right-4 -bottom-4 text-6xl opacity-5">🎯</div>
          <div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">個人平均客單價</p>
            <p className="text-3xl font-black text-white font-mono"><span className="text-sm mr-0.5">$</span>{(stats.averageSpend || 0).toLocaleString()}</p>
          </div>
        </div>
      </section>

      <section className="mb-10 animate-fade-in" style={{ animationDelay: '0.15s' }}>
         <h3 className="text-xs font-black tracking-widest uppercase text-white mb-4 border-l-4 border-[#D4AF37] pl-3">
           📊 各項服務大數拆解 (Gross Revenue Breakdown)
         </h3>
         <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.keys(detailedBreakdown || {}).length === 0 ? (
               <div className="col-span-full bg-[#121212] p-6 rounded-2xl border border-dashed border-white/5 text-center text-gray-600 text-xs tracking-widest font-bold">目前尚無分類大數紀錄</div>
            ) : (
               Object.entries(detailedBreakdown || {})
                 .sort((a, b) => {
                   const indexA = PREFERRED_ORDER.indexOf(a[0]);
                   const indexB = PREFERRED_ORDER.indexOf(b[0]);
                   
                   if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                   if (indexA !== -1) return -1;
                   if (indexB !== -1) return 1;

                   const charA = a[0].charAt(0);
                   const charB = b[0].charAt(0);
                   const weight = { 'R': 1, 'W': 2, 'P': 3 };
                   const wA = weight[charA] || 99;
                   const wB = weight[charB] || 99;
                   if (wA !== wB) return wA - wB;

                   return a[0].localeCompare(b[0]);
                 }) 
                 .map(([code, data]) => (
                 <div key={code} className="bg-gradient-to-br from-[#1a1a1a] to-[#121212] p-5 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-colors shadow-lg relative overflow-hidden">
                    <div className="relative z-10 flex flex-col h-full justify-between gap-3">
                       
                       <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest truncate" title={globalLabels[code]}>
                         {code === 'ASSISTANT_BONUS' ? '🤝 助手特別獎金' : 
                          code === 'SCALP_PROD' ? '🌱 頭皮產品' : 
                          code === '未綁定參數' ? '⚠️ 未綁定參數' : 
                          `${code} - ${globalLabels[code] || '自訂項目'}`}
                       </p>
                       
                       <div>
                         <p className="text-xl font-black text-[#D4AF37] font-mono tracking-tighter">
                           <span className="text-gray-500 text-sm mr-1">$</span>{Math.round(Number(data.amount)).toLocaleString()}
                         </p>
                         <p className="text-[10px] text-gray-400 font-bold mt-1">
                           共 <span className="text-white">{data.count}</span> 單
                         </p>
                       </div>

                    </div>
                    
                    <div className="absolute right-[-10px] bottom-[-10px] text-5xl opacity-[0.03] font-black italic pointer-events-none">
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
           <p className="text-[10px] text-gray-500 font-mono">共計 {(myTransactions || []).length} 筆項目</p>
        </div>

        {loading && (myTransactions || []).length === 0 ? (
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
                {(myTransactions || []).map(tx => {
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
                          <span className={`text-sm ${tx.type === 'assistant_bonus' ? 'text-[#D4AF37] font-bold' : 'text-gray-200'}`}>
                            {tx.type === 'assistant_bonus' ? '助手服務' : (tx.service || '未知項目')}
                          </span>
                          <div className="flex gap-2 items-center mt-0.5">
                            {tx.type === 'assistant_bonus' && <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 uppercase">助手獎金</span>}
                            {tx.isAppliedBonus && <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/30 uppercase font-bold animate-pulse"><i className="fa-solid fa-bolt-lightning mr-1"></i>階梯達標加成</span>}
                            {tx.computedCode === 'SCALP' && <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30 uppercase font-mono">套票 {dynamicTierStats.finalScalpPct}%</span>}
                            {tx.computedCode === 'SCALP_PROD' && <span className="text-[9px] bg-teal-500/20 text-teal-400 px-1.5 py-0.5 rounded border border-teal-500/30 uppercase font-mono">產品 {dynamicTierStats.finalProdPct}%</span>}
                          </div>
                        </div>
                      </td>
                      <td className="p-5 text-white font-bold font-mono">
                        ${Math.round(Number(tx.amount || 0)).toLocaleString()}
                      </td>
                      <td className="p-5 text-[#D4AF37] font-black font-mono text-right">
                        ${Math.round(tx.computedCommission || 0).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}

                {(myTransactions || []).length === 0 && !loading && (
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
