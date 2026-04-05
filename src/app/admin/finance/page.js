"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // 🟢 視圖切換：dashboard | payroll | settings
  const [viewMode, setViewMode] = useState('dashboard');
  
  const [currentAdminRole, setCurrentAdminRole] = useState('reception');
  const [currentUserName, setCurrentUserName] = useState(''); // 🟢 儲存當前登入者姓名供過濾用
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const [transactions, setTransactions] = useState([]);
  const [staffConfig, setStaffConfig] = useState([]);
  const [usersRef, setUsersRef] = useState([]);
  const [servicesData, setServicesData] = useState([]); // 🟢 用來抓取服務標籤
  const [packagesData, setPackagesData] = useState([]); // 🟢 用來抓取套票標籤
  
  const [metrics, setMetrics] = useState({ totalCashIn: 0, totalServiceValue: 0, totalGivenPoints: 0, outstandingTDollar: 0 });
  const [stylistRanking, setStylistRanking] = useState([]);
  const [serviceRanking, setServiceRanking] = useState([]);
  const [payrollReport, setPayrollReport] = useState([]);

  // 🟢 用於展開明細 Modal 的狀態
  const [selectedStaffDetail, setSelectedStaffDetail] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.push('/login');
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (docSnap.exists()) {
        const role = docSnap.data().role;
        const name = docSnap.data().name;
        setCurrentAdminRole(role);
        setCurrentUserName(name);
        
        // 🚫 嚴格阻擋會員與櫃台進入財務區
        if (role === 'member' || role === 'reception') {
          toast.error("⛔ 權限不足：您無法進入財務報表區");
          router.push(role === 'member' ? '/dashboard' : '/admin/pos');
          return;
        }
      }
    });
    fetchFinancialData();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (transactions.length > 0) calculateData();
  }, [selectedMonth, transactions, staffConfig, usersRef, servicesData, packagesData]);

  const fetchFinancialData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "transactions"), orderBy("timestamp", "desc"));
      const txSnap = await getDocs(q);
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const uSnap = await getDocs(collection(db, "users"));
      setUsersRef(uSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const staffSnap = await getDocs(collection(db, 'staff'));
      setStaffConfig(staffSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const svSnap = await getDocs(collection(db, 'services'));
      setServicesData(svSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const pkSnap = await getDocs(collection(db, 'packages'));
      setPackagesData(pkSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
    } catch (error) { toast.error("讀取財務數據失敗"); } 
    finally { setLoading(false); }
  };

  const calculateData = () => {
    const monthlyTx = transactions.filter(tx => tx.timestamp && tx.timestamp.startsWith(selectedMonth));
    
    let cashIn = 0; let serviceValue = 0; let givenPoints = 0; let totalOutstanding = 0;
    let stylists = {}; let services = {}; let stylistAggregator = {};

    usersRef.forEach(u => { totalOutstanding += (u.tDollarBalance || 0); });

    // 初始化員工數據包
    staffConfig.forEach(staff => {
      stylistAggregator[staff.name] = { 
        name: staff.name, 
        grade: staff.grade || '未分級', 
        commissionsRule: staff.commissions || {}, 
        totalRevenue: 0, 
        totalCommission: 0, 
        clientCount: 0, 
        details: [] 
      };
    });

    monthlyTx.forEach(tx => {
      if (tx.type === 'topup') {
        cashIn += Number(tx.amountPaidHKD || 0);
        givenPoints += Number(tx.pointsAdded || 0);
      } 
      else if (tx.type === 'deduct' || tx.type === 'walkin_cash' || tx.type === 'deduct_package') {
        const stylistName = tx.stylist || '未指定';
        if (!stylistAggregator[stylistName]) {
          stylistAggregator[stylistName] = { name: stylistName, grade: '無資料', commissionsRule: {}, totalRevenue: 0, totalCommission: 0, clientCount: 0, details: [] };
        }

        const staff = stylistAggregator[stylistName];
        let revenue = 0;
        let commCode = null;
        let formulaStr = "無提成標籤";

        // 🟢 判斷是一般服務還是扣套票
        if (tx.type === 'deduct' || tx.type === 'walkin_cash') {
          revenue = Number(tx.amount || 0); // 實收金額
          const serviceItem = servicesData.find(s => s.name === tx.service);
          commCode = serviceItem ? serviceItem.commissionCode : null;
          services[tx.service || '一般服務'] = (services[tx.service || '一般服務'] || 0) + revenue;
        } 
        else if (tx.type === 'deduct_package') {
          const pkgItem = packagesData.find(p => p.name === tx.packageName);
          if (pkgItem) {
            const perGridValue = Number(pkgItem.price) / Number(pkgItem.quantity); // 計算單格價值
            revenue = tx.deductedGrids * perGridValue;
            commCode = pkgItem.commissionCode; // 通常是 SCALP
          }
        }

        // 🟢 套用矩陣公式計算佣金
        let commission = 0;
        if (commCode && staff.commissionsRule[commCode]) {
          const rule = staff.commissionsRule[commCode];
          if (revenue > rule.deduct) {
            commission = (revenue - rule.deduct) * (rule.percent / 100);
            formulaStr = `($${revenue.toFixed(1)} - 扣$${rule.deduct}) x ${rule.percent}%`;
          } else {
            formulaStr = `實收低於耗材扣款 ($${rule.deduct})`;
          }
        }

        serviceValue += revenue;
        stylists[stylistName] = (stylists[stylistName] || 0) + revenue;

        staff.totalRevenue += revenue;
        staff.totalCommission += commission;
        staff.clientCount += 1;
        
        // 儲存明細供 Modal 顯示
        staff.details.push({
          id: tx.id,
          date: new Date(tx.timestamp).toLocaleString('zh-HK', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
          service: tx.service || tx.packageName,
          type: tx.type,
          commCode: commCode || 'N/A',
          revenue: revenue,
          commission: commission,
          formulaStr: formulaStr
        });
      }
    });

    setMetrics({ totalCashIn: cashIn, totalServiceValue: serviceValue, totalGivenPoints: givenPoints, outstandingTDollar: totalOutstanding });
    setStylistRanking(Object.entries(stylists).sort((a, b) => b[1] - a[1]));
    setServiceRanking(Object.entries(services).sort((a, b) => b[1] - a[1]));

    const report = Object.values(stylistAggregator)
      .filter(s => s.clientCount > 0 || s.name === currentUserName) // 過濾掉沒接客的，但保留自己
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
    
    setPayrollReport(report);
  };

  const handleManualBackup = async () => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    const toastId = toast.loading("正在打包全系統資料...");
    try {
      const collectionsToBackup = ['users', 'transactions', 'staff', 'services', 'categories', 'tiers', 'appointments', 'active_sessions', 'packages', 'templates', 'settings'];
      let backupData = { metadata: { exportedAt: new Date().toISOString(), version: 'TRUST_OS_1.0' } };
      for (const colName of collectionsToBackup) {
        const snap = await getDocs(collection(db, colName));
        backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `TRUST_OS_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success("✅ 系統資料備份已成功下載！", { id: toastId });
    } catch (error) { toast.error("備份失敗", { id: toastId }); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">報表生成中...</div>;

  // 🛡️ 權限隔離：髮型師只能看自己
  const isManagement = ['admin', 'manager'].includes(currentAdminRole);
  const displayPayroll = isManagement ? payrollReport : payrollReport.filter(s => s.name === currentUserName);

  // 🟢 計算預計發放總佣金 (僅供管理層看)
  const totalCommissionPayout = displayPayroll.reduce((sum, staff) => sum + staff.totalCommission, 0);

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
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              店鋪營收與階梯式抽成結算系統
              {!isManagement && <span className="text-red-400 ml-2">(員工模式：僅顯示個人業績)</span>}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
             {currentAdminRole === 'admin' && (
                <button onClick={handleManualBackup} className="bg-blue-900/30 text-blue-400 border border-blue-800/50 hover:bg-blue-600 hover:text-white px-5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2">
                  <i className="fa-solid fa-cloud-arrow-down"></i> 輸出備份
                </button>
             )}
             <div className="bg-[#121212] border border-white/10 p-2 rounded-xl flex items-center gap-3 shadow-inner">
               <i className="fa-regular fa-calendar ml-3 text-[#D4AF37]"></i>
               <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="bg-transparent text-white font-bold outline-none cursor-pointer pr-3 text-sm" />
             </div>
          </div>
        </header>

        {/* 頂部視圖切換器 */}
        <div className="flex flex-wrap gap-2 mb-8 bg-[#121212] p-1.5 rounded-2xl border border-white/5 inline-flex">
          {/* 🟢 髮型師看不到 Dashboard，強制預設為 payroll */}
          {isManagement && (
            <button onClick={() => setViewMode('dashboard')} className={`px-6 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'dashboard' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}>
              <i className="fa-solid fa-chart-line"></i> 營運儀表板
            </button>
          )}
          <button onClick={() => setViewMode('payroll')} className={`px-6 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${(viewMode === 'payroll' || !isManagement) ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}>
            <i className="fa-solid fa-file-invoice-dollar"></i> 薪資與抽成結算明細
          </button>
        </div>

        {/* =========================================
            視圖 1：營運儀表板 (Dashboard) - 僅管理層可見
        ========================================= */}
        {viewMode === 'dashboard' && isManagement && (
          <div className="animate-fade-in">
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
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">預計發放總佣金</p>
                <div className="flex items-baseline gap-1 text-red-400">
                  <span className="text-2xl font-bold">$</span>
                  <p className="text-4xl font-black tracking-tighter">{totalCommissionPayout.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
                </div>
              </div>

              <div className="bg-[#1a1a1a] p-8 rounded-[32px] border border-red-500/20 relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-bl-[100px] -z-10"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  系統未消費餘額 <i className="fa-solid fa-circle-info text-gray-600" title="此數字不受月份影響，為全店當下總負債"></i>
                </p>
                <p className="text-3xl font-black text-gray-300 tracking-tighter">${metrics.outstandingTDollar.toLocaleString()}</p>
              </div>
            </div>

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
                          ) : tx.type === 'deduct_package' ? (
                            <span className="text-[9px] bg-purple-500/10 text-purple-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Package</span>
                          ) : (
                            <span className="text-[9px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Service</span>
                          )}
                        </td>
                        <td className="py-4 text-white font-bold">{tx.phoneNumber}</td>
                        <td className="py-4 text-gray-400">
                          {tx.type === 'topup' ? `收取 ${tx.paymentMethod} $${tx.amountPaidHKD}` : (
                            <span className="flex items-center gap-2">
                              {tx.service || tx.packageName} <span className="text-[9px] bg-white/10 px-2 py-0.5 rounded text-[#D4AF37]">{tx.stylist}</span>
                            </span>
                          )}
                        </td>
                        <td className={`py-4 font-mono font-bold text-right ${tx.type === 'topup' ? 'text-green-500' : 'text-white'}`}>
                          {tx.type === 'topup' ? '+' : '-'}${tx.type === 'topup' ? tx.tDollarAdded : (tx.amount || 0)}
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
            視圖 2：薪資與矩陣抽成結算 (Payroll)
        ========================================= */}
        {(viewMode === 'payroll' || !isManagement) && (
          <div className="space-y-4 animate-fade-in">
            {displayPayroll.map((staff, index) => (
              <div key={staff.name} className="bg-[#1a1a1a] p-6 rounded-[32px] border border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-xl hover:border-[#D4AF37]/50 transition-colors">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#D4AF37] to-yellow-700 flex items-center justify-center text-xl font-black text-black shadow-lg">
                    {staff.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h4 className="text-xl font-bold text-white">{staff.name}</h4>
                      <span className="text-[10px] bg-white/10 text-gray-300 px-2 py-0.5 rounded font-bold uppercase tracking-widest">{staff.grade} 級師傅</span>
                      {isManagement && index === 0 && <i className="fa-solid fa-crown text-[#D4AF37] text-sm ml-1" title="Top Performer"></i>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">本月共服務 <span className="text-white font-bold">{staff.clientCount}</span> 個項目</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 w-full md:w-auto bg-black/50 p-4 rounded-2xl border border-white/5">
                   <div>
                     <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">創造產值 (Revenue)</p>
                     <p className="text-xl font-mono text-white">${staff.totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
                   </div>
                   <div className="border-l border-white/10 pl-6">
                     <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-1">個人抽成 (Commission)</p>
                     <p className="text-xl font-mono font-black text-[#D4AF37]">${staff.totalCommission.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
                   </div>
                   <div className="border-l border-white/10 pl-6 flex items-center">
                      <button onClick={() => setSelectedStaffDetail(staff)} className="bg-white/10 hover:bg-white text-white hover:text-black px-4 py-2 rounded-xl text-xs font-bold transition-colors">
                        查看算式明細 <i className="fa-solid fa-chevron-right ml-1"></i>
                      </button>
                   </div>
                </div>
              </div>
            ))}
            {displayPayroll.length === 0 && (
               <div className="text-center py-20 text-gray-600 font-bold border border-dashed border-gray-800 rounded-3xl">此月份尚無業績紀錄</div>
            )}
          </div>
        )}
      </div>

      {/* 🟢 算式明細展開 Modal */}
      {selectedStaffDetail && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 md:p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-4xl max-h-[90vh] rounded-[40px] p-6 md:p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative flex flex-col animate-fade-in">
            <button onClick={() => setSelectedStaffDetail(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
              <i className="fa-solid fa-xmark text-2xl"></i>
            </button>
            
            <div className="mb-6 border-b border-white/10 pb-6 shrink-0">
              <h2 className="text-2xl md:text-3xl font-black text-white italic tracking-tighter">Commission <span className="text-[#D4AF37]">Details</span></h2>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm font-bold text-gray-300">髮型師：{selectedStaffDetail.name}</span>
                <span className="text-[10px] bg-[#D4AF37]/20 text-[#D4AF37] px-2 py-0.5 rounded uppercase tracking-widest">{selectedStaffDetail.grade} 級模板</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
              {selectedStaffDetail.details.length === 0 ? (
                 <p className="text-center text-gray-500 py-10">此月份尚無明細</p>
              ) : (
                selectedStaffDetail.details.map((item, idx) => (
                  <div key={idx} className="bg-black/50 p-4 md:p-5 rounded-2xl border border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-white/20 transition-colors">
                    <div className="flex-1 w-full">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-bold text-sm md:text-base">{item.service}</span>
                        <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-bold uppercase">{item.commCode} 類</span>
                        {item.type === 'deduct_package' && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">扣套票</span>}
                      </div>
                      <p className="text-[10px] text-gray-500">{item.date}</p>
                    </div>
                    
                    <div className="w-full md:w-auto bg-[#1a1a1a] p-3 rounded-xl border border-white/5">
                      <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">拆帳計算公式</p>
                      <p className="text-xs text-gray-300 font-mono">{item.formulaStr}</p>
                    </div>

                    <div className="w-full md:w-32 text-right shrink-0">
                      <p className="text-[9px] text-[#D4AF37] uppercase tracking-widest mb-1">實得佣金</p>
                      <p className="text-lg font-black text-[#D4AF37] font-mono">
                        ${item.commission.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D4AF37; }
      `}</style>
    </div>
  );
}
