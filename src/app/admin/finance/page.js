"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, where } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  const [viewMode, setViewMode] = useState('dashboard');
  const [currentAdminRole, setCurrentAdminRole] = useState('reception');
  const [currentUserName, setCurrentUserName] = useState(''); 
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('ALL');

  const [transactions, setTransactions] = useState([]);
  const [staffConfig, setStaffConfig] = useState([]);
  const [outstandingTDollar, setOutstandingTDollar] = useState(0); 
  
  const [servicesData, setServicesData] = useState([]); 
  const [packagesData, setPackagesData] = useState([]); 
  
  const [metrics, setMetrics] = useState({ totalCashIn: 0, totalServiceValue: 0, totalGivenPoints: 0, outstandingTDollar: 0 });
  const [stylistRanking, setStylistRanking] = useState([]);
  const [serviceRanking, setServiceRanking] = useState([]);
  const [payrollReport, setPayrollReport] = useState([]);

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
        
        if (role === 'member' || role === 'reception') {
          toast.error("⛔ 權限不足：您無法進入財務報表區");
          router.push(role === 'member' ? '/dashboard' : '/admin/pos');
          return;
        }
      }
    });
    fetchFinancialData();
    return () => unsubscribe();
  }, [selectedMonth]); 

  useEffect(() => {
    if (transactions.length > 0) calculateData();
  }, [selectedBranch, transactions, staffConfig, servicesData, packagesData]);

  const fetchFinancialData = async () => {
    setLoading(true);
    try {
      const startOfMonth = `${selectedMonth}-01T00:00:00`;
      const endOfMonth = `${selectedMonth}-31T23:59:59`;
      const qTx = query(collection(db, "transactions"), where("timestamp", ">=", startOfMonth), where("timestamp", "<=", endOfMonth));
      
      const txSnap = await getDocs(qTx);
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      if (currentAdminRole === 'admin' || currentAdminRole === 'manager') {
         const uSnap = await getDocs(query(collection(db, "users"), where("tDollarBalance", ">", 0)));
         let totalOut = 0;
         uSnap.docs.forEach(d => { totalOut += (d.data().tDollarBalance || 0); });
         setOutstandingTDollar(totalOut);
      }

      const staffSnap = await getDocs(collection(db, 'staff'));
      setStaffConfig(staffSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const svSnap = await getDocs(collection(db, 'services'));
      setServicesData(svSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const pkSnap = await getDocs(collection(db, 'packages'));
      setPackagesData(pkSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const bSnap = await getDocs(collection(db, 'branches'));
      setBranches(bSnap.docs.map(d => d.data().name));
      
    } catch (error) { toast.error("讀取財務數據失敗"); } 
    finally { setLoading(false); }
  };

  const calculateData = () => {
    const filteredTx = transactions.filter(tx => {
      return selectedBranch === 'ALL' || tx.branch === selectedBranch || (!tx.branch && selectedBranch === 'ALL');
    });
    
    let cashIn = 0; let serviceValue = 0; let givenPoints = 0; 
    let stylists = {}; let services = {}; let stylistAggregator = {};

    staffConfig.forEach(staff => {
      stylistAggregator[staff.name] = { 
        name: staff.name, 
        grade: staff.templateName || '自訂比例', 
        commissionsRule: staff.commissions || {}, 
        totalRevenue: 0, totalCommission: 0, clientCount: 0, details: [] 
      };
    });

    filteredTx.forEach(tx => {
      if (tx.type === 'topup') {
        cashIn += Number(tx.amountPaidHKD || 0);
        givenPoints += Number(tx.pointsAdded || 0);
      } 
      else if (tx.type === 'deduct' || tx.type === 'walkin_cash' || tx.type === 'deduct_package') {
        const stylistName = tx.stylist || '未指定';
        if (!stylistAggregator[stylistName]) {
          stylistAggregator[stylistName] = { name: stylistName, grade: '無資料 (未綁定)', commissionsRule: {}, totalRevenue: 0, totalCommission: 0, clientCount: 0, details: [] };
        }

        const staff = stylistAggregator[stylistName];
        let revenue = 0; let commCode = null; let formulaStr = "";

        if (tx.type === 'deduct' || tx.type === 'walkin_cash') {
          revenue = Number(tx.amount || 0);
          const serviceItem = servicesData.find(s => s.name === tx.service);
          commCode = serviceItem ? serviceItem.commissionCode : null;
          services[tx.service || '一般服務'] = (services[tx.service || '一般服務'] || 0) + revenue;
        } 
        else if (tx.type === 'deduct_package') {
          const pkgItem = packagesData.find(p => p.name === tx.packageName);
          if (pkgItem) {
            const perGridValue = Number(pkgItem.price) / Number(pkgItem.quantity); 
            revenue = Number((tx.deductedGrids * perGridValue).toFixed(1)); 
            commCode = pkgItem.commissionCode; 
          }
        }

        let commission = 0;
        
        if (!commCode) {
            formulaStr = "服務項目未綁定抽成標籤 (需至CMS設定)";
        } else if (!staff.commissionsRule || Object.keys(staff.commissionsRule).length === 0) {
            formulaStr = "該設計師未儲存抽成參數 (需至CMS重新按儲存)";
        } else if (staff.commissionsRule[commCode] === undefined) {
            formulaStr = `該設計師未設定 ${commCode} 類參數`;
        } else {
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
        
        staff.details.push({
          id: tx.id,
          date: new Date(tx.timestamp).toLocaleString('zh-HK', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
          service: tx.service || tx.packageName,
          type: tx.type, commCode: commCode || 'N/A', revenue: revenue, commission: commission, formulaStr: formulaStr, branch: tx.branch || '未知門店'
        });
      }
    });

    setMetrics({ totalCashIn: cashIn, totalServiceValue: serviceValue, totalGivenPoints: givenPoints, outstandingTDollar: selectedBranch === 'ALL' ? outstandingTDollar : 0 });
    setStylistRanking(Object.entries(stylists).sort((a, b) => b[1] - a[1]));
    setServiceRanking(Object.entries(services).sort((a, b) => b[1] - a[1]));

    const report = Object.values(stylistAggregator).filter(s => s.clientCount > 0 || s.name === currentUserName).sort((a, b) => b.totalRevenue - a.totalRevenue);
    setPayrollReport(report);
  };

  const handleManualBackup = async () => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    const toastId = toast.loading("正在打包全系統原始資料...");
    try {
      const collectionsToBackup = ['users', 'transactions', 'staff', 'services', 'categories', 'tiers', 'appointments', 'packages', 'templates', 'settings', 'branches'];
      let backupData = { metadata: { exportedAt: new Date().toISOString(), version: 'TRUST_OS_1.0' } };
      for (const colName of collectionsToBackup) {
        const snap = await getDocs(collection(db, colName));
        backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `TRUST_Database_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success("✅ 系統資料備份已成功下載！", { id: toastId });
    } catch (error) { toast.error("備份失敗", { id: toastId }); }
  };

  // 🟢 全新功能：匯出財務報表至 Excel (CSV)
  const exportToCSV = () => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    const toastId = toast.loading("正在產生 Excel 財務報表...");
    try {
      let csvContent = '\uFEFF'; // 加入 BOM 讓 Excel 支援中文 UTF-8
      
      // 1. 報表檔頭
      csvContent += `TRUST 沙龍財務報表\n`;
      csvContent += `報表月份,${selectedMonth}\n`;
      csvContent += `篩選門店,${selectedBranch === 'ALL' ? '全線總計' : selectedBranch}\n\n`;

      // 2. 營收總覽
      csvContent += `【營收總覽】\n`;
      csvContent += `充值現金流,$${metrics.totalCashIn}\n`;
      csvContent += `店鋪總產值 (扣T-Dollar),$${metrics.totalServiceValue}\n\n`;

      // 3. 薪資與抽成表
      const displayPayroll = payrollReport;
      const totalCommissionPayout = displayPayroll.reduce((sum, staff) => sum + staff.totalCommission, 0);
      csvContent += `【髮型師薪資與抽成結算】\n`;
      csvContent += `髮型師,模板級別,服務客數,創造產值,實得佣金\n`;
      displayPayroll.forEach(staff => {
        csvContent += `${staff.name},${staff.grade},${staff.clientCount},$${staff.totalRevenue},$${staff.totalCommission}\n`;
      });
      csvContent += `,,,總計發放佣金,$${totalCommissionPayout}\n\n`;

      // 4. 交易明細清單
      csvContent += `【本月交易明細流水帳】\n`;
      csvContent += `交易時間,門店,交易類型,客戶電話,項目/髮型師,變動金額\n`;
      const filteredTx = transactions.filter(tx => selectedBranch === 'ALL' || tx.branch === selectedBranch || (!tx.branch && selectedBranch === 'ALL'));
      filteredTx.forEach(tx => {
        const date = new Date(tx.timestamp).toLocaleString('zh-HK');
        const type = tx.type === 'topup' ? '增值/TopUp' : tx.type === 'deduct_package' ? '扣抵套票' : '服務消費';
        let itemDetail = '';
        if (tx.type === 'topup') itemDetail = `收取 ${tx.paymentMethod} $${tx.amountPaidHKD}`;
        else itemDetail = `${tx.service || tx.packageName} (${tx.stylist})`;
        const amount = tx.type === 'topup' ? `+$${tx.tDollarAdded}` : `-$${tx.amount || 0}`;
        const safePhone = tx.phoneNumber ? `'${tx.phoneNumber}` : ''; // 加單引號避免 Excel 把電話變科學記號

        csvContent += `${date},${tx.branch || '未指定'},${type},${safePhone},${itemDetail},${amount}\n`;
      });

      // 觸發下載
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TRUST_Financial_Report_${selectedBranch}_${selectedMonth}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      
      toast.success("✅ 財務報表已成功匯出！", { id: toastId });
    } catch (error) {
      toast.error("報表匯出失敗", { id: toastId });
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">報表生成中...</div>;

  const isManagement = ['admin', 'manager'].includes(currentAdminRole);
  const displayPayroll = isManagement ? payrollReport : payrollReport.filter(s => s.name === currentUserName);
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
             {/* 🟢 新增：匯出報表 CSV 按鈕 */}
             {currentAdminRole === 'admin' && (
                <>
                  <button onClick={exportToCSV} className="bg-green-900/30 text-green-400 border border-green-800/50 hover:bg-green-600 hover:text-white px-5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2">
                    <i className="fa-solid fa-file-excel"></i> 匯出報表 (CSV)
                  </button>
                  <button onClick={handleManualBackup} className="bg-blue-900/30 text-blue-400 border border-blue-800/50 hover:bg-blue-600 hover:text-white px-5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2">
                    <i className="fa-solid fa-cloud-arrow-down"></i> 系統備份 (JSON)
                  </button>
                </>
             )}

             {isManagement && (
               <div className="bg-[#121212] border border-white/10 p-2 rounded-xl flex items-center gap-3 shadow-inner">
                 <i className="fa-solid fa-store ml-3 text-[#D4AF37]"></i>
                 <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="bg-transparent text-white font-bold outline-none cursor-pointer pr-3 text-sm appearance-none">
                   <option value="ALL">🌐 全線總計 (All Branches)</option>
                   {branches.map(b => <option key={b} value={b}>📍 {b}</option>)}
                 </select>
               </div>
             )}

             <div className="bg-[#121212] border border-white/10 p-2 rounded-xl flex items-center gap-3 shadow-inner">
               <i className="fa-regular fa-calendar ml-3 text-[#D4AF37]"></i>
               <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="bg-transparent text-white font-bold outline-none cursor-pointer pr-3 text-sm" />
             </div>
          </div>
        </header>

        <div className="flex flex-wrap gap-2 mb-8 bg-[#121212] p-1.5 rounded-2xl border border-white/5 inline-flex">
          {isManagement && (
            <button onClick={() => setViewMode('dashboard')} className={`px-6 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'dashboard' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}>
              <i className="fa-solid fa-chart-line"></i> 營運儀表板
            </button>
          )}
          <button onClick={() => setViewMode('payroll')} className={`px-6 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${(viewMode === 'payroll' || !isManagement) ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'}`}>
            <i className="fa-solid fa-file-invoice-dollar"></i> 薪資與抽成結算明細
          </button>
        </div>

        {viewMode === 'dashboard' && isManagement && (
          <div className="animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden group hover:border-green-500/50 transition-colors">
                <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-bl-[100px] -z-10 group-hover:bg-green-500/20 transition-colors"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                  {selectedBranch === 'ALL' ? '全線' : selectedBranch}充值現金流 (HKD)
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl text-green-500 font-bold">$</span>
                  <p className="text-4xl font-black text-white tracking-tighter">{metrics.totalCashIn.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-[#1a1a1a] to-black p-8 rounded-[32px] border border-[#D4AF37]/30 relative overflow-hidden shadow-[0_0_20px_rgba(212,175,55,0.05)]">
                <div className="absolute -right-5 -bottom-5 text-[#D4AF37] opacity-10 text-7xl -z-10"><i className="fa-solid fa-fire"></i></div>
                <p className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest mb-2">
                  {selectedBranch === 'ALL' ? '店鋪總業績' : `${selectedBranch} 產值`} (扣 T-Dollar)
                </p>
                <div className="flex items-baseline gap-1 text-[#D4AF37]">
                  <span className="text-2xl font-bold">$</span>
                  <p className="text-4xl font-black tracking-tighter">{metrics.totalServiceValue.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
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

              <div className={`bg-[#1a1a1a] p-8 rounded-[32px] border relative overflow-hidden ${selectedBranch === 'ALL' ? 'border-red-500/20' : 'border-white/5'}`}>
                 {selectedBranch === 'ALL' && <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-bl-[100px] -z-10"></div>}
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  系統未消費餘額 <i className="fa-solid fa-circle-info text-gray-600" title="此數字不受月份影響，為全店當下總負債"></i>
                </p>
                <p className="text-3xl font-black text-gray-300 tracking-tighter">
                  {selectedBranch === 'ALL' ? `$${metrics.outstandingTDollar.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}` : '---'}
                </p>
                {selectedBranch !== 'ALL' && <p className="text-[9px] text-gray-500 mt-1">餘額屬全線通用，單店不計負債</p>}
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
                            <span className="text-[#D4AF37] font-mono">${val.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</span>
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
                            <span className="text-white font-mono">${val.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</span>
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
              <h3 className="text-xl font-bold text-white mb-8 italic">Recent Transactions <span className="text-xs font-normal text-gray-500 not-italic ml-2">(篩選後前20筆)</span></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10">
                      <th className="pb-4 font-bold">時間 (Time)</th>
                      <th className="pb-4 font-bold">門店 (Branch)</th>
                      <th className="pb-4 font-bold">類型 (Type)</th>
                      <th className="pb-4 font-bold">客戶 (Customer)</th>
                      <th className="pb-4 font-bold">項目 / 髮型師</th>
                      <th className="pb-4 font-bold text-right">變動金額</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm font-light">
                    {transactions
                      .filter(tx => selectedBranch === 'ALL' || tx.branch === selectedBranch || (!tx.branch && selectedBranch === 'ALL'))
                      .slice(0, 20).map((tx) => (
                      <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 text-[10px] text-gray-500 font-mono uppercase">{new Date(tx.timestamp).toLocaleString('zh-HK', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' })}</td>
                        <td className="py-4 text-[10px] text-gray-400 font-bold">{tx.branch || '未指定'}</td>
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
                    {transactions.filter(tx => selectedBranch === 'ALL' || tx.branch === selectedBranch).length === 0 && (
                      <tr><td colSpan="6" className="py-10 text-center text-gray-600 font-bold tracking-widest">此篩選條件下無交易紀錄</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {(viewMode === 'payroll' || !isManagement) && (
          <div className="space-y-4 animate-fade-in">
            {displayPayroll.map((staff, index) => (
              <div key={staff.name} className={`bg-[#1a1a1a] p-6 rounded-[32px] border flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-xl transition-colors ${staff.grade.includes('未綁定') ? 'border-red-500/50' : 'border-white/5 hover:border-[#D4AF37]/50'}`}>
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#D4AF37] to-yellow-700 flex items-center justify-center text-xl font-black text-black shadow-lg">
                    {staff.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h4 className="text-xl font-bold text-white">{staff.name}</h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest ${staff.grade.includes('未綁定') ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-gray-300'}`}>{staff.grade}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">本篩選共服務 <span className="text-white font-bold">{staff.clientCount}</span> 個項目</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 w-full md:w-auto bg-black/50 p-4 rounded-2xl border border-white/5">
                   <div>
                     <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">創造產值 (Revenue)</p>
                     <p className="text-xl font-mono text-white">${staff.totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
                   </div>
                   <div className="border-l border-white/10 pl-6">
                     <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-1">個人抽成 (Commission)</p>
                     <p className={`text-xl font-mono font-black ${staff.totalCommission === 0 && staff.totalRevenue > 0 ? 'text-red-400' : 'text-[#D4AF37]'}`}>${staff.totalCommission.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})}</p>
                   </div>
                   <div className="border-l border-white/10 pl-6 flex items-center">
                      <button onClick={() => setSelectedStaffDetail(staff)} className="bg-white/10 hover:bg-white text-white hover:text-black px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2">
                        {staff.totalCommission === 0 && staff.totalRevenue > 0 && <i className="fa-solid fa-triangle-exclamation text-red-500"></i>}
                        查看算式明細 <i className="fa-solid fa-chevron-right ml-1"></i>
                      </button>
                   </div>
                </div>
              </div>
            ))}
            {displayPayroll.length === 0 && (
               <div className="text-center py-20 text-gray-600 font-bold border border-dashed border-gray-800 rounded-3xl">此篩選條件下尚無業績紀錄</div>
            )}
          </div>
        )}
      </div>

      {selectedStaffDetail && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 md:p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-4xl max-h-[90vh] rounded-[40px] p-6 md:p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative flex flex-col animate-fade-in">
            <button onClick={() => setSelectedStaffDetail(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
              <i className="fa-solid fa-xmark text-2xl"></i>
            </button>
            
            <div className="mb-6 border-b border-white/10 pb-6 shrink-0">
              <h2 className="text-2xl md:text-3xl font-black text-white italic tracking-tighter">Commission <span className="text-[#D4AF37]">Details</span></h2>
              <div className="flex flex-col md:flex-row md:items-center gap-3 mt-2">
                <span className="text-sm font-bold text-gray-300">髮型師：{selectedStaffDetail.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-widest w-fit ${selectedStaffDetail.grade.includes('未綁定') ? 'bg-red-500/20 text-red-400' : 'bg-[#D4AF37]/20 text-[#D4AF37]'}`}>{selectedStaffDetail.grade}</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
              {selectedStaffDetail.details.length === 0 ? (
                 <p className="text-center text-gray-500 py-10">此月份尚無明細</p>
              ) : (
                selectedStaffDetail.details.map((item, idx) => (
                  <div key={idx} className={`bg-black/50 p-4 md:p-5 rounded-2xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-colors ${item.formulaStr.includes('未綁定') || item.formulaStr.includes('未儲存') ? 'border-red-500/30' : 'border-white/5 hover:border-white/20'}`}>
                    <div className="flex-1 w-full">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-white font-bold text-sm md:text-base">{item.service}</span>
                        <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-bold uppercase">{item.commCode} 類</span>
                        {item.type === 'deduct_package' && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">扣抵套票</span>}
                        <span className="text-[9px] border border-gray-600 text-gray-400 px-1.5 py-0.5 rounded font-bold uppercase">📍 {item.branch}</span>
                      </div>
                      <p className="text-[10px] text-gray-500">{item.date}</p>
                    </div>
                    
                    <div className="w-full md:w-auto bg-[#1a1a1a] p-3 rounded-xl border border-white/5">
                      <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">拆帳計算診斷</p>
                      <p className={`text-xs font-mono font-bold ${item.formulaStr.includes('未綁定') || item.formulaStr.includes('未儲存') ? 'text-red-400' : 'text-gray-300'}`}>
                        {item.formulaStr}
                      </p>
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
