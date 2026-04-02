"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // 視圖切換：dashboard (營運概況) | payroll (薪資結算)
  const [viewMode, setViewMode] = useState('dashboard');
  
  // 當前操作者權限
  const [currentAdminRole, setCurrentAdminRole] = useState('reception');

  // 月份篩選 (預設當前月份)
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  // 原始數據
  const [transactions, setTransactions] = useState([]);
  const [staffConfig, setStaffConfig] = useState([]);
  const [usersRef, setUsersRef] = useState([]);
  
  // ==========================================
  // 計算後的指標狀態
  // ==========================================
  const [metrics, setMetrics] = useState({ totalCashIn: 0, totalServiceValue: 0, totalGivenPoints: 0, outstandingTDollar: 0 });
  const [stylistRanking, setStylistRanking] = useState([]);
  const [serviceRanking, setServiceRanking] = useState([]);
  const [payrollReport, setPayrollReport] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.push('/login');
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) setCurrentAdminRole(docSnap.data().role);
    });
    fetchFinancialData();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (transactions.length > 0) calculateData();
  }, [selectedMonth, transactions, staffConfig, usersRef]);

  const fetchFinancialData = async () => {
    setLoading(true);
    try {
      // 1. 抓取交易紀錄
      const q = query(collection(db, "transactions"), orderBy("timestamp", "desc"));
      const txSnap = await getDocs(q);
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      // 2. 抓取所有用戶 (算負債)
      const uSnap = await getDocs(collection(db, "users"));
      setUsersRef(uSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // 3. 抓取髮型師抽成設定
      const staffSnap = await getDocs(collection(db, 'staff'));
      setStaffConfig(staffSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
    } catch (error) { toast.error("讀取財務數據失敗"); } 
    finally { setLoading(false); }
  };

  // 🟢 核心運算引擎 (同時計算營運儀表板與薪資)
  const calculateData = () => {
    const monthlyTx = transactions.filter(tx => tx.timestamp && tx.timestamp.startsWith(selectedMonth));
    
    let cashIn = 0;
    let serviceValue = 0;
    let givenPoints = 0;
    let totalOutstanding = 0;
    
    let stylists = {};
    let services = {};
    let stylistAggregator = {};

    // 算系統總負債 (不受月份影響，是當下狀態)
    usersRef.forEach(u => { totalOutstanding += (u.tDollarBalance || 0); });

    monthlyTx.forEach(tx => {
      if (tx.type === 'topup') {
        cashIn += Number(tx.amountPaidHKD || 0);
        givenPoints += Number(tx.pointsAdded || 0);
      } 
      else if (tx.type === 'deduct' || tx.type === 'walkin_cash') {
        const amount = Number(tx.amount || 0);
        serviceValue += amount;
        
        const stylistName = tx.stylist || '未指定';
        const serviceName = tx.service || '一般服務';
        
        // 排行榜用
        stylists[stylistName] = (stylists[stylistName] || 0) + amount;
        services[serviceName] = (services[serviceName] || 0) + amount;

        // 薪資結算用
        if (!stylistAggregator[stylistName]) stylistAggregator[stylistName] = { totalRevenue: 0, clientCount: 0 };
        stylistAggregator[stylistName].totalRevenue += amount;
        stylistAggregator[stylistName].clientCount += 1;
      }
    });

    setMetrics({ totalCashIn: cashIn, totalServiceValue: serviceValue, totalGivenPoints: givenPoints, outstandingTDollar: totalOutstanding });
    setStylistRanking(Object.entries(stylists).sort((a, b) => b[1] - a[1]));
    setServiceRanking(Object.entries(services).sort((a, b) => b[1] - a[1]));

    // 🟢 薪資與階梯抽成計算
    const report = Object.keys(stylistAggregator).map(stylistName => {
      const stats = stylistAggregator[stylistName];
      const rev = stats.totalRevenue;
      
      const config = staffConfig.find(s => s.name === stylistName) || {};
      const baseRate = Number(config.baseCommission) || 0.3;
      const target = Number(config.targetRevenue) || Infinity;
      const bonusRate = Number(config.bonusCommission) || baseRate;

      const isTargetHit = rev >= target && target > 0;
      const finalRate = isTargetHit ? bonusRate : baseRate;
      const commissionPayout = rev * finalRate;

      return {
        name: stylistName, clientCount: stats.clientCount, revenue: rev,
        target: target === Infinity ? '無設定' : `$${target}`,
        isTargetHit, appliedRate: finalRate, commission: commissionPayout
      };
    }).sort((a, b) => b.revenue - a.revenue);
    
    setPayrollReport(report);
  };

  // 🟢 老闆專屬：手動打包全系統資料庫
  const handleManualBackup = async () => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    
    const toastId = toast.loading("正在打包全系統資料 (請勿關閉網頁)...");
    try {
      // 欲備份的模組清單
      const collectionsToBackup = ['users', 'transactions', 'staff', 'services', 'categories', 'tiers', 'appointments', 'active_sessions'];
      let backupData = { 
        metadata: { exportedAt: new Date().toISOString(), version: 'TRUST_OS_1.0' } 
      };

      // 遍歷並拉取所有資料
      for (const colName of collectionsToBackup) {
        const snap = await getDocs(collection(db, colName));
        backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      // 轉換成 JSON Blob 並觸發下載
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TRUST_OS_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("✅ 系統資料備份已成功下載！", { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error("備份失敗，請檢查網路連線", { id: toastId });
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">報表生成中...</div>;

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-6 md:p-10 font-sans pb-24 selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <Toaster position="top-right" />
      
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-6 border-b border-white/5 pb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tighter flex items-center gap-3 italic text-white mb-2">
              <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg not-italic">EXECUTIVE</span> FINANCE
            </h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">店鋪營收與階梯式抽成結算系統</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
             {/* 🟢 老闆專屬備份按鈕 */}
             {currentAdminRole === 'admin' && (
                <button onClick={handleManualBackup} className="bg-blue-900/30 text-blue-400 border border-blue-800/50 hover:bg-blue-600 hover:text-white px-5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2">
                  <i className="fa-solid fa-cloud-arrow-down"></i> 輸出備份
                </button>
             )}
             
             {/* 月份選擇器 */}
             <div className="bg-[#121212] border border-white/10 p-2 rounded-xl flex items-center gap-3 shadow-inner">
               <i className="fa-regular fa-calendar ml-3 text-[#D4AF37]"></i>
               <input 
                 type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}
                 className="bg-transparent text-white font-bold outline-none cursor-pointer pr-3 text-sm"
               />
             </div>
          </div>
        </header>

        {/* 🟢 頂部視圖切換器 */}
        <div className="flex gap-2 mb-8 bg-[#121212] p-1.5 rounded-2xl border border-white/5 inline-flex">
          <button onClick={() => setViewMode('dashboard')} className={`px-8 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'dashboard' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}>
            <i className="fa-solid fa-chart-line"></i> 營運儀表板
          </button>
          <button onClick={() => setViewMode('payroll')} className={`px-8 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'payroll' ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}>
            <i className="fa-solid fa-file-invoice-dollar"></i> 薪資與抽成
          </button>
        </div>

        {/* =========================================
            視圖 1：營運儀表板 (Dashboard)
        ========================================= */}
        {viewMode === 'dashboard' && (
          <div className="animate-fade-in">
            {/* 四大核心指標 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden group hover:border-green-500/50 transition-colors">
                <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-bl-[100px] -z-10 group-hover:bg-green-500/20 transition-colors"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">門市充值現金流 (HKD)</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl text-green-500 font-bold">$</span>
                  <p className="text-4xl font-black text-white tracking-tighter">{metrics.totalCashIn.toLocaleString()}</p>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-[#1a1a1a] to-black p-8 rounded-[32px] border border-[#D4AF37]/30 relative overflow-hidden shadow-[0_0_20px_rgba(212,175,55,0.05)]">
                <div className="absolute -right-5 -bottom-5 text-[#D4AF37] opacity-10 text-7xl -z-10"><i className="fa-solid fa-fire"></i></div>
                <p className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest mb-2">店鋪總業績 (扣 T-Dollar)</p>
                <div className="flex items-baseline gap-1 text-[#D4AF37]">
                  <span className="text-2xl font-bold">$</span>
                  <p className="text-4xl font-black tracking-tighter">{metrics.totalServiceValue.toLocaleString()}</p>
                </div>
              </div>

              <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden group hover:border-blue-500/50 transition-colors">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-[100px] -z-10 group-hover:bg-blue-500/20 transition-colors"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">充值派發總積分</p>
                <p className="text-4xl font-black text-white tracking-tighter">{metrics.totalGivenPoints.toLocaleString()}</p>
              </div>

              <div className="bg-[#1a1a1a] p-8 rounded-[32px] border border-red-500/20 relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-bl-[100px] -z-10"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  系統未消費餘額 <i className="fa-solid fa-circle-info text-gray-600" title="此數字不受月份影響，為全店當下總負債"></i>
                </p>
                <p className="text-3xl font-black text-gray-300 tracking-tighter">${metrics.outstandingTDollar.toLocaleString()}</p>
              </div>
            </div>

            {/* 業績排行榜 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl">
                <div className="flex justify-between items-end mb-8 border-b border-white/5 pb-4">
                  <h3 className="text-xl font-bold text-white italic">Stylist Performance</h3>
                  <span className="text-[10px] bg-white/10 px-3 py-1 rounded-full text-gray-400">業績貢獻度</span>
                </div>
                <div className="space-y-6">
                  {stylistRanking.length === 0 ? <p className="text-sm text-gray-600">尚無業績紀錄</p> : 
                    stylistRanking.map(([name, val], index) => {
                      const percentage = metrics.totalServiceValue > 0 ? (val / metrics.totalServiceValue) * 100 : 0;
                      return (
                        <div key={name} className="relative">
                          <div className="flex justify-between text-sm font-bold uppercase tracking-widest mb-2">
                            <span className="flex items-center gap-3">
                              <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] ${index === 0 ? 'bg-[#D4AF37] text-black' : index === 1 ? 'bg-gray-300 text-black' : index === 2 ? 'bg-[#CD7F32] text-white' : 'bg-white/10 text-gray-400'}`}>{index + 1}</span>
                              {name}
                            </span>
                            <span className="text-[#D4AF37] font-mono">${val.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                            <div className="bg-[#D4AF37] h-full rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>

              <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl">
                <div className="flex justify-between items-end mb-8 border-b border-white/5 pb-4">
                  <h3 className="text-xl font-bold text-white italic">Top Services</h3>
                  <span className="text-[10px] bg-white/10 px-3 py-1 rounded-full text-gray-400">熱門項目</span>
                </div>
                <div className="space-y-6">
                  {serviceRanking.length === 0 ? <p className="text-sm text-gray-600">尚無項目紀錄</p> : 
                    serviceRanking.slice(0, 5).map(([name, val], index) => {
                      const percentage = metrics.totalServiceValue > 0 ? (val / metrics.totalServiceValue) * 100 : 0;
                      return (
                        <div key={name} className="relative">
                          <div className="flex justify-between text-xs font-bold uppercase tracking-widest mb-2">
                            <span className="text-gray-300">{name}</span>
                            <span className="text-white font-mono">${val.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-blue-500/80 h-full rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                          </div>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            </div>
            
            {/* 近期交易紀錄 */}
            <div className="bg-[#121212] rounded-[40px] p-10 border border-white/5 shadow-2xl overflow-hidden">
              <h3 className="text-xl font-bold text-white mb-8 italic">Recent Transactions <span className="text-xs font-normal text-gray-500 not-italic ml-2">(本月前20筆)</span></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10">
                      <th className="pb-4 font-bold">時間 (Time)</th>
                      <th className="pb-4 font-bold">類型 (Type)</th>
                      <th className="pb-4 font-bold">客戶 (Customer)</th>
                      <th className="pb-4 font-bold">項目 / 髮型師</th>
                      <th className="pb-4 font-bold text-right">變動金額</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm font-light">
                    {transactions.filter(tx => tx.timestamp && tx.timestamp.startsWith(selectedMonth)).slice(0, 20).map((tx) => (
                      <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 text-[10px] text-gray-500 font-mono uppercase">{new Date(tx.timestamp).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' })}</td>
                        <td className="py-4">
                          {tx.type === 'topup' ? (
                            <span className="text-[9px] bg-green-500/10 text-green-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Top Up</span>
                          ) : (
                            <span className="text-[9px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Service</span>
                          )}
                        </td>
                        <td className="py-4 text-white font-bold">{tx.phoneNumber}</td>
                        <td className="py-4 text-gray-400">
                          {tx.type === 'topup' ? `收取 ${tx.paymentMethod} $${tx.amountPaidHKD}` : (
                            <span className="flex items-center gap-2">
                              {tx.service} <span className="text-[9px] bg-white/10 px-2 py-0.5 rounded text-[#D4AF37]">{tx.stylist}</span>
                            </span>
                          )}
                        </td>
                        <td className={`py-4 font-mono font-bold text-right ${tx.type === 'topup' ? 'text-green-500' : 'text-white'}`}>
                          {tx.type === 'topup' ? '+' : '-'}${tx.type === 'topup' ? tx.tDollarAdded : tx.amount}
                        </td>
                      </tr>
                    ))}
                    {transactions.filter(tx => tx.timestamp && tx.timestamp.startsWith(selectedMonth)).length === 0 && (
                      <tr><td colSpan="5" className="py-10 text-center text-gray-600 font-bold tracking-widest">本月尚無任何交易紀錄</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================
            視圖 2：薪資與階梯抽成結算 (Payroll)
        ========================================= */}
        {viewMode === 'payroll' && (
          <div className="bg-[#121212] rounded-[40px] border border-white/5 overflow-hidden shadow-2xl animate-fade-in">
            <div className="p-8 border-b border-white/5 bg-gradient-to-r from-[#1a1a1a] to-[#121212]">
               <h3 className="text-xl font-bold text-white mb-2">階梯式薪資結算表</h3>
               <p className="text-[10px] text-gray-500 uppercase tracking-widest">Systematic Commission Calculation based on CMS Rules</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5 bg-black/20">
                    <th className="p-6 font-bold">髮型師 (Stylist)</th>
                    <th className="p-6 font-bold">服務客數</th>
                    <th className="p-6 font-bold">創造業績 (Revenue)</th>
                    <th className="p-6 font-bold text-center">階梯達標判定</th>
                    <th className="p-6 font-bold text-right">應發抽成獎金 (Payout)</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {payrollReport.map((row, index) => (
                    <tr key={row.name} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                      <td className="p-6">
                        <div className="flex items-center gap-4">
                           <span className="text-gray-600 font-black text-lg w-4">{index + 1}</span>
                           <span className="text-white font-bold text-base flex items-center gap-2">
                             {row.name}
                             {index === 0 && <i className="fa-solid fa-crown text-[#D4AF37] text-xs" title="Top Performer"></i>}
                           </span>
                        </div>
                      </td>
                      <td className="p-6 text-gray-400 font-mono">{row.clientCount} 位</td>
                      <td className="p-6">
                        <span className="text-lg font-bold text-white font-mono">${row.revenue.toLocaleString()}</span>
                      </td>
                      <td className="p-6 text-center">
                        {row.target === '無設定' ? (
                           <span className="text-[10px] bg-gray-800 text-gray-400 px-3 py-1 rounded-full uppercase tracking-widest">無門檻</span>
                        ) : row.isTargetHit ? (
                           <div className="inline-flex flex-col items-center">
                             <span className="text-[10px] bg-green-500/20 text-green-400 px-3 py-1 rounded-full uppercase tracking-widest font-bold border border-green-500/30">
                               <i className="fa-solid fa-rocket mr-1"></i> 成功達標
                             </span>
                             <span className="text-[9px] text-gray-500 mt-1">門檻: {row.target}</span>
                           </div>
                        ) : (
                           <div className="inline-flex flex-col items-center">
                             <span className="text-[10px] bg-white/5 text-gray-400 px-3 py-1 rounded-full uppercase tracking-widest">未達標</span>
                             <span className="text-[9px] text-gray-500 mt-1">門檻: {row.target}</span>
                           </div>
                        )}
                      </td>
                      <td className="p-6 text-right">
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">
                          套用比率: <strong className={row.isTargetHit ? 'text-[#D4AF37]' : 'text-white'}>{(row.appliedRate * 100).toFixed(0)}%</strong>
                        </p>
                        <p className={`text-2xl font-black font-mono ${row.isTargetHit ? 'text-[#D4AF37] drop-shadow-[0_0_10px_rgba(212,175,55,0.3)]' : 'text-white'}`}>
                          ${row.commission.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                      </td>
                    </tr>
                  ))}
                  {payrollReport.length === 0 && (
                    <tr><td colSpan="5" className="p-16 text-center text-gray-500 font-bold border-dashed border-t border-white/5 uppercase tracking-widest text-xs">本月尚無任何服務結算紀錄</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
