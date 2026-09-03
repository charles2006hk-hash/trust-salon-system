"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, where, updateDoc, arrayUnion, addDoc } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

// 🚀 引入核心財務計算引擎，確保前台(設計師)與後台(老闆)拆帳邏輯 100% 同步
import { calculateStaffCommissions } from '@/lib/finance';

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
  
  const defaultLabels = {
    W1: '洗剪吹 (需扣耗材)', W2: '洗剪吹 (純抽成)', W3: '洗剪吹 (高階)', 
    R1: '染燙化學 (需扣耗材)', R2: '染燙化學 (純抽成)', R3: '染燙化學 (進階)', 
    P1: '產品 (20%)', P2: '產品 (25%)', P3: '產品 (18%)', P4: '產品 (15%)', P5: '產品 (35%)', 
    SCALP: '頭皮套票'
  };
  const [globalLabels, setGlobalLabels] = useState(defaultLabels);

  const [metrics, setMetrics] = useState({ totalCashIn: 0, totalServiceValue: 0, totalGivenPoints: 0, outstandingTDollar: 0, tDollarDeducted: 0 });
  const [stylistRanking, setStylistRanking] = useState([]);
  const [serviceRanking, setServiceRanking] = useState([]);
  const [payrollReport, setPayrollReport] = useState([]);

  const [selectedStaffDetail, setSelectedStaffDetail] = useState(null);

  const [editingTx, setEditingTx] = useState(null);
  const [originalTx, setOriginalTx] = useState(null); 
  const [isUpdatingTx, setIsUpdatingTx] = useState(false);
  const [viewingHistoryTx, setViewingHistoryTx] = useState(null);

  const handleUpdateTransaction = async (e) => {
    e.preventDefault();
    if (currentAdminRole !== 'admin') return toast.error("⛔ 僅限 Admin 修改單據！");
    
    const toastId = toast.loading("正在覆寫單據資料並寫入全域審計紀錄...");
    setIsUpdatingTx(true);
    try {
      const txRef = doc(db, 'transactions', editingTx.id);
      const isBonus = editingTx.type === 'assistant_bonus';
      
      const oldAmount = isBonus ? Number(originalTx.bonusAmount || 0) : Number(originalTx.amount || 0);
      const newAmount = isBonus ? Number(editingTx.bonusAmount || 0) : Number(editingTx.amount || 0);
      
      const oldItem = isBonus ? '🤝 助手特別獎金' : (originalTx.service || originalTx.packageName || '未指定');
      const newItem = isBonus ? '🤝 助手特別獎金' : (editingTx.service || editingTx.packageName || '未指定');

      const auditLog = {
        editedAt: new Date().toISOString(),
        editedBy: currentUserName || 'Admin', 
        oldAmount: oldAmount,
        newAmount: newAmount,
        oldStylist: originalTx.stylist || '未指定',
        newStylist: editingTx.stylist || '未指定',
        oldService: oldItem,
        newService: newItem
      };

      const updatePayload = {
        stylist: editingTx.stylist || '未指定',
        editHistory: arrayUnion(auditLog)
      };

      if (isBonus) {
         updatePayload.bonusAmount = newAmount;
      } else {
         updatePayload.amount = newAmount;
         if (editingTx.packageName !== undefined) {
            updatePayload.packageName = editingTx.packageName;
         } else {
            updatePayload.service = editingTx.service;
         }
      }

      await updateDoc(txRef, updatePayload);

      await addDoc(collection(db, 'audit_logs'), {
        module: 'finance_transactions',
        action: 'edit_transaction',
        transactionId: editingTx.id,
        customerPhone: editingTx.phoneNumber || '未提供',
        branch: editingTx.branch || '未指定',
        timestamp: new Date().toISOString(),
        adminName: currentUserName || 'Admin',
        changes: auditLog
      });
      
      toast.success("✅ 單據修改成功！歷史紀錄已永久保存。", { id: toastId });
      setEditingTx(null);
      setOriginalTx(null); 
      fetchFinancialData(); 
    } catch (error) {
      console.error(error);
      toast.error("修改失敗，請檢查網路連線", { id: toastId });
    } finally {
      setIsUpdatingTx(false);
    }
  };

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
  }, [selectedBranch, transactions, staffConfig, servicesData, packagesData, globalLabels]);

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
      const staffList = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStaffConfig(staffList);
      
      const svSnap = await getDocs(collection(db, 'services'));
      setServicesData(svSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      const pkSnap = await getDocs(collection(db, 'packages'));
      setPackagesData(pkSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const bSnap = await getDocs(collection(db, 'branches'));
      setBranches(bSnap.docs.map(d => d.data().name));

      const settingsSnap = await getDoc(doc(db, 'settings', 'global_config'));
      if (settingsSnap.exists() && settingsSnap.data().commissionLabels) {
        setGlobalLabels(settingsSnap.data().commissionLabels);
      }
      
    } catch (error) { toast.error("讀取財務數據失敗"); } 
    finally { setLoading(false); }
  };

  const calculateData = () => {
    const filteredTx = transactions.filter(tx => {
      return selectedBranch === 'ALL' || tx.branch === selectedBranch || (!tx.branch && selectedBranch === 'ALL');
    });
    
    // 建立服務對應表供引擎使用
    const serviceMap = {};
    servicesData.forEach(d => { serviceMap[d.name] = d.commissionCode || 'W1' });
    packagesData.forEach(d => { serviceMap[d.name] = d.commissionCode || 'SCALP' });

    let cashIn = 0; let serviceValue = 0; let givenPoints = 0; let tDollarDeducted = 0;
    let stylists = {}; let services = {}; 
    let stylistAggregator = {};
    const stylistsTxs = {}; // 用於將帳單按設計師分組

    filteredTx.forEach(tx => {
      if (tx.type === 'topup' || tx.type === 'buy_package') {
        cashIn += Number(tx.amountPaidHKD || 0);
        if (tx.type === 'topup') givenPoints += Number(tx.pointsAdded || 0);
      } 
      else if (['deduct', 'walkin_cash', 'deduct_package', 'assistant_bonus'].includes(tx.type)) {
        const stylistName = tx.stylist || '未指定';
        if (!stylistsTxs[stylistName]) stylistsTxs[stylistName] = [];
        
        // 修正套票扣點的營業額 (針對財務首頁儀表板產值)
        let normalizedAmount = Number(tx.amount || 0);
        if (tx.type === 'deduct_package') {
          const pkgItem = packagesData.find(p => p.name === tx.packageName);
          if (pkgItem) {
            const perGridValue = Number(pkgItem.price) / Number(pkgItem.quantity); 
            normalizedAmount = Number((tx.deductedGrids * perGridValue).toFixed(1)); 
            tx.amount = normalizedAmount; // 補齊 amount 欄位供引擎使用
          }
        }
        
        if (tx.type !== 'assistant_bonus') {
           serviceValue += normalizedAmount;
           stylists[stylistName] = (stylists[stylistName] || 0) + normalizedAmount;
           services[tx.service || tx.packageName || '一般服務'] = (services[tx.service || tx.packageName || '一般服務'] || 0) + normalizedAmount;
           if (tx.type === 'deduct') tDollarDeducted += normalizedAmount;
        }
        
        stylistsTxs[stylistName].push(tx);
      }
    });

    // 🚀 呼叫共用核心引擎：逐一結算每個設計師的總薪資
    Object.keys(stylistsTxs).forEach(sName => {
       const sTxs = stylistsTxs[sName];
       const staffDef = staffConfig.find(s => s.name === sName) || { templateName: '無資料 (未綁定)', commissions: {} };
       
       // 調用與前台完全一致的計算引擎
       const result = calculateStaffCommissions(sTxs, staffDef.commissions || {}, serviceMap, globalLabels);
       
       stylistAggregator[sName] = {
          name: sName,
          grade: staffDef.templateName || '自訂比例',
          commissionsRule: staffDef.commissions || {},
          totalRevenue: result.stats.totalRevenue,
          totalCommission: result.stats.totalCommission,
          clientCount: result.stats.clientCount,
          dynamicTierStats: result.dynamicTierStats, // 保存階梯狀態供 UI 顯示
          details: result.processedTransactions.map(tx => {
             // 重組 UI 顯示字串
             let formulaStr = '';
             if (tx.type === 'assistant_bonus') {
                formulaStr = `店家發放定額獎金 ($${tx.computedCommission})`;
             } else if (tx.computedCode === 'SCALP') {
                formulaStr = `動態階梯算法 (套票 ${result.dynamicTierStats.finalScalpPct}%)`;
             } else if (tx.computedCode === 'SCALP_PROD') {
                formulaStr = `動態階梯算法 (產品 ${result.dynamicTierStats.finalProdPct}%)`;
             } else {
                const rule = (staffDef.commissions || {})[tx.computedCode];
                if (!rule) formulaStr = `未設定 ${tx.computedCode} 參數`;
                else formulaStr = `($${Number(tx.amount||0).toFixed(1)} - 扣$${rule.deduct}) x ${rule.percent}%`;
             }
             
             return {
               id: tx.id,
               date: new Date(tx.timestamp).toLocaleString('zh-HK', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' }),
               service: tx.type === 'assistant_bonus' ? '助手服務' : (tx.service || tx.packageName),
               type: tx.type, 
               commCode: tx.computedCode || 'N/A', 
               revenue: tx.type === 'assistant_bonus' ? 0 : Math.round(Number(tx.amount||0)), 
               commission: Math.round(tx.computedCommission), 
               formulaStr: formulaStr, 
               branch: tx.branch || '未知門店'
             }
          })
       };
    });

    setMetrics({ 
      totalCashIn: Math.round(cashIn), 
      totalServiceValue: Math.round(serviceValue), 
      totalGivenPoints: Math.round(givenPoints), 
      outstandingTDollar: selectedBranch === 'ALL' ? Math.round(outstandingTDollar) : 0, 
      tDollarDeducted: Math.round(tDollarDeducted) 
    });
    setStylistRanking(Object.entries(stylists).map(([name, val]) => [name, Math.round(val)]).sort((a, b) => b[1] - a[1]));
    setServiceRanking(Object.entries(services).map(([name, val]) => [name, Math.round(val)]).sort((a, b) => b[1] - a[1]));

    const report = Object.values(stylistAggregator).filter(s => s.clientCount > 0 || s.name === currentUserName).sort((a, b) => b.totalRevenue - a.totalRevenue);
    
    setPayrollReport(report);
  };

  const handleManualBackup = async () => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    const toastId = toast.loading("正在打包全系統原始資料...");
    try {
      const collectionsToBackup = ['users', 'transactions', 'staff', 'services', 'categories', 'tiers', 'appointments', 'packages', 'templates', 'settings', 'branches'];
      let backupData = { metadata: { exportedAt: new Date().toISOString(), version: 'TRUST_OS_1.1' } };
      
      let hasError = false;
      let errorTables = [];

      for (const colName of collectionsToBackup) {
        try {
          const snap = await getDocs(collection(db, colName));
          backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
          console.error(`讀取 ${colName} 失敗:`, e);
          hasError = true;
          errorTables.push(colName);
          backupData[colName] = { error: "權限不足或資料表不存在" };
        }
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `TRUST_Database_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      
      if (hasError) {
        toast.success(`⚠️ 備份完成，但跳過了沒有權限的資料表：${errorTables.join(', ')}`, { id: toastId, duration: 6000 });
      } else {
        toast.success("✅ 系統資料備份已成功下載！", { id: toastId });
      }
    } catch (error) { 
      toast.error(`備份失敗：${error.message}`, { id: toastId }); 
    }
  };

  const exportToCSV = () => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    const toastId = toast.loading("正在產生 Excel 財務報表...");
    try {
      let csvContent = '\uFEFF'; 
      csvContent += `TRUST 沙龍財務報表\n`;
      csvContent += `報表月份,${selectedMonth}\n`;
      csvContent += `篩選門店,${selectedBranch === 'ALL' ? '全線總計' : selectedBranch}\n\n`;

      csvContent += `【營收與跨店結算總覽】\n`;
      csvContent += `充值與售票現金流,$${metrics.totalCashIn}\n`;
      csvContent += `店鋪總產值 (包含扣餘額與現金),$${metrics.totalServiceValue}\n`;
      csvContent += `使用 T-Dollar 扣抵總額 (總部應撥款),$${metrics.tDollarDeducted}\n\n`;

      const displayPayroll = payrollReport;
      const totalCommissionPayout = displayPayroll.reduce((sum, staff) => sum + staff.totalCommission, 0);
      csvContent += `【髮型師薪資與抽成結算】\n`;
      csvContent += `髮型師,模板級別,參與客數,創造產值,實得佣金\n`;
      displayPayroll.forEach(staff => {
        csvContent += `${staff.name},${staff.grade},${staff.clientCount},$${staff.totalRevenue},$${staff.totalCommission}\n`;
      });
      csvContent += `,,,總計發放佣金,$${totalCommissionPayout}\n\n`;

      csvContent += `【本月交易明細流水帳】\n`;
      csvContent += `交易時間,門店,交易類型,客戶電話,項目/髮型師,變動金額\n`;
      const filteredTx = transactions.filter(tx => selectedBranch === 'ALL' || tx.branch === selectedBranch || (!tx.branch && selectedBranch === 'ALL'));
      filteredTx.forEach(tx => {
        const date = new Date(tx.timestamp).toLocaleString('zh-HK');
        let type = '服務消費';
        if (tx.type === 'topup') type = '增值/TopUp';
        if (tx.type === 'buy_package') type = '購買套票';
        if (tx.type === 'deduct_package') type = '扣抵套票';
        if (tx.type === 'assistant_bonus') type = '助手獎金';

        let itemDetail = '';
        if (tx.type === 'topup' || tx.type === 'buy_package') itemDetail = `收取 ${tx.paymentMethod} $${tx.amountPaidHKD}`;
        else itemDetail = `${tx.service || tx.packageName} (${tx.stylist})`;
        
        let amount = `-$${Math.round(tx.amount || 0)}`;
        if (tx.type === 'topup') amount = `+$${tx.tDollarAdded}`;
        if (tx.type === 'buy_package') amount = `+$${tx.amountPaidHKD}`;
        if (tx.type === 'assistant_bonus') amount = `(獎金) +$${tx.bonusAmount}`;

        const safePhone = tx.phoneNumber ? `'${tx.phoneNumber}` : ''; 

        csvContent += `${date},${tx.branch || '未指定'},${type},${safePhone},${itemDetail},${amount}\n`;
      });

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
               <div className="bg-[#121212] border border-white/10 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-inner hover:border-[#D4AF37]/50 transition-colors">
                 <i className="fa-solid fa-store text-[#D4AF37] pointer-events-none"></i>
                 <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="bg-transparent text-white font-bold outline-none cursor-pointer pr-3 text-sm appearance-none w-full">
                   <option value="ALL">🌐 全線總計 (All Branches)</option>
                   {branches.map(b => <option key={b} value={b}>📍 {b}</option>)}
                 </select>
               </div>
             )}

             <div className="relative bg-[#121212] border border-white/10 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-inner hover:border-[#D4AF37]/50 transition-colors focus-within:border-[#D4AF37]">
               <i className="fa-regular fa-calendar text-[#D4AF37] pointer-events-none"></i>
               <input 
                 type="month" 
                 value={selectedMonth} 
                 onChange={(e) => setSelectedMonth(e.target.value)} 
                 className="bg-transparent text-white font-bold outline-none cursor-pointer text-sm custom-month-input" 
               />
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden group hover:border-green-500/50 transition-colors">
                <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-bl-[100px] -z-10 group-hover:bg-green-500/20 transition-colors"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  {selectedBranch === 'ALL' ? '全線' : selectedBranch} 現金流收入 (HKD) <i className="fa-solid fa-circle-info text-gray-600" title="包含增值與直接售出套票的實收現金"></i>
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl text-green-500 font-bold">$</span>
                  <p className="text-4xl font-black text-white tracking-tighter">{metrics.totalCashIn.toLocaleString()}</p>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-[#1a1a1a] to-black p-8 rounded-[32px] border border-[#D4AF37]/30 relative overflow-hidden shadow-[0_0_20px_rgba(212,175,55,0.05)]">
                <div className="absolute -right-5 -bottom-5 text-[#D4AF37] opacity-10 text-7xl -z-10"><i className="fa-solid fa-fire"></i></div>
                <p className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest mb-2">
                  {selectedBranch === 'ALL' ? '全線總產值' : `${selectedBranch} 產值`} (包含現金與扣餘額)
                </p>
                <div className="flex items-baseline gap-1 text-[#D4AF37]">
                  <span className="text-2xl font-bold">$</span>
                  <p className="text-4xl font-black tracking-tighter">{metrics.totalServiceValue.toLocaleString()}</p>
                </div>
              </div>

              <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden group hover:border-red-500/50 transition-colors">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-bl-[100px] -z-10 group-hover:bg-red-500/20 transition-colors"></div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">預計發放總佣金成本</p>
                <div className="flex items-baseline gap-1 text-red-400">
                  <span className="text-2xl font-bold">$</span>
                  <p className="text-4xl font-black tracking-tighter">{totalCommissionPayout.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
              <div className="bg-purple-900/10 p-8 rounded-[32px] border border-purple-500/20 relative overflow-hidden group hover:border-purple-500/50 transition-colors">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-bl-[100px] -z-10 transition-colors"></div>
                <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  🎫 {selectedBranch === 'ALL' ? '全線' : selectedBranch} T-Dollar 勞務消耗扣抵總額
                </p>
                <div className="flex items-baseline gap-1 text-purple-300">
                  <span className="text-3xl font-bold">$</span>
                  <p className="text-5xl font-black tracking-tighter">{metrics.tDollarDeducted.toLocaleString()}</p>
                </div>
                {selectedBranch !== 'ALL' && <p className="text-[9px] text-gray-500 mt-2">💡 此為該店點「使用餘額扣抵」的總額。若貴公司各分店採獨立財務核算，總部需將此金額撥款補貼給該實體店。</p>}
              </div>

              <div className={`bg-[#1a1a1a] p-8 rounded-[32px] border relative overflow-hidden ${selectedBranch === 'ALL' ? 'border-red-500/20' : 'border-white/5 opacity-50'}`}>
                 {selectedBranch === 'ALL' && <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-bl-[100px] -z-10"></div>}
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  系統總未消費餘額 <i className="fa-solid fa-circle-info text-gray-600" title="此數字不受月份影響，為全店當下總負債"></i>
                </p>
                <p className="text-4xl font-black text-gray-300 tracking-tighter">
                  {selectedBranch === 'ALL' ? `$${metrics.outstandingTDollar.toLocaleString()}` : '---'}
                </p>
                {selectedBranch !== 'ALL' && <p className="text-[9px] text-gray-500 mt-2">請切換至「全線總計」以查看全系統總負債餘額</p>}
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
                      {currentAdminRole === 'admin' && <th className="pb-4 font-bold text-center">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="text-sm font-light">
                    {transactions
                      .filter(tx => selectedBranch === 'ALL' || tx.branch === selectedBranch || (!tx.branch && selectedBranch === 'ALL'))
                      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                      .slice(0, 20).map((tx) => (
                      <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 text-[10px] text-gray-500 font-mono uppercase">{new Date(tx.timestamp).toLocaleString('zh-HK', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' })}</td>
                        <td className="py-4 text-[10px] text-gray-400 font-bold">{tx.branch || '未指定'}</td>
                        <td className="py-4">
                          {tx.type === 'topup' ? (
                            <span className="text-[9px] bg-green-500/10 text-green-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Top Up</span>
                          ) : tx.type === 'buy_package' ? (
                            <span className="text-[9px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Buy Pkg</span>
                          ) : tx.type === 'deduct_package' ? (
                            <span className="text-[9px] bg-purple-500/10 text-purple-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Use Pkg</span>
                          ) : tx.type === 'assistant_bonus' ? (
                            <span className="text-[9px] bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Bonus</span>
                          ) : (
                            <span className="text-[9px] bg-gray-500/10 text-gray-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Service</span>
                          )}
                        </td>
                        <td className="py-4 text-white font-bold">{tx.phoneNumber}</td>
                        <td className="py-4 text-gray-400">
                          {tx.type === 'topup' || tx.type === 'buy_package' ? `收取 ${tx.paymentMethod} $${tx.amountPaidHKD}` : (
                            <span className="flex items-center gap-2">
                              {tx.type === 'assistant_bonus' ? '助手服務' : (tx.service || tx.packageName)} <span className="text-[9px] bg-white/10 px-2 py-0.5 rounded text-[#D4AF37]">{tx.stylist}</span>
                            </span>
                          )}
                        </td>
                        <td className={`py-4 font-mono font-bold text-right ${tx.type === 'topup' || tx.type === 'buy_package' ? 'text-green-500' : tx.type === 'assistant_bonus' ? 'text-yellow-400' : 'text-white'}`}>
                          {tx.type === 'topup' ? '+' : tx.type === 'buy_package' ? '+' : tx.type === 'assistant_bonus' ? '+' : '-'}${tx.type === 'topup' ? tx.tDollarAdded : tx.type === 'buy_package' ? tx.amountPaidHKD : tx.type === 'assistant_bonus' ? tx.bonusAmount : (tx.amount || 0)}
                        </td>
                        
                        {currentAdminRole === 'admin' && (
                          <td className="py-4 text-center">
                            <div className="flex flex-col items-center gap-2">
                              {(tx.type === 'deduct' || tx.type === 'walkin_cash' || tx.type === 'deduct_package' || tx.type === 'assistant_bonus') && (
                                <button 
                                  onClick={() => {
                                    setEditingTx({...tx}); 
                                    setOriginalTx(tx); 
                                  }}
                                  className="bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition w-full"
                                >
                                  <i className="fa-solid fa-pen"></i> 修改
                                </button>
                              )}
                              
                              {tx.editHistory && tx.editHistory.length > 0 && (
                                <button 
                                  onClick={() => setViewingHistoryTx(tx)}
                                  className="bg-purple-500/10 text-purple-400 hover:bg-purple-500 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1 w-full"
                                >
                                  <i className="fa-solid fa-clock-rotate-left"></i> 查帳
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {transactions.filter(tx => selectedBranch === 'ALL' || tx.branch === selectedBranch).length === 0 && (
                      <tr><td colSpan="7" className="py-10 text-center text-gray-600 font-bold tracking-widest">此篩選條件下無交易紀錄</td></tr>
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
                    <p className="text-xs text-gray-500 mt-1">本篩選共參與 <span className="text-white font-bold">{staff.clientCount}</span> 個客戶結帳</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 w-full md:w-auto bg-black/50 p-4 rounded-2xl border border-white/5">
                   <div>
                     <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">創造產值 (Revenue)</p>
                     <p className="text-xl font-mono text-white">${staff.totalRevenue.toLocaleString()}</p>
                   </div>
                   <div className="border-l border-white/10 pl-6">
                     <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-1">實得佣金與獎金</p>
                     <p className={`text-xl font-mono font-black ${staff.totalCommission === 0 && staff.totalRevenue > 0 ? 'text-red-400' : 'text-[#D4AF37]'}`}>${staff.totalCommission.toLocaleString()}</p>
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
                <span className="text-sm font-bold text-gray-300">人員姓名：{selectedStaffDetail.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-widest w-fit ${selectedStaffDetail.grade.includes('未綁定') ? 'bg-red-500/20 text-red-400' : 'bg-[#D4AF37]/20 text-[#D4AF37]'}`}>{selectedStaffDetail.grade}</span>
              </div>
              
              {/* 🟢 在 Admin 報表中也同步顯示該設計師的動態階梯狀態 */}
              {selectedStaffDetail.dynamicTierStats && (
                <div className="flex flex-wrap gap-4 mt-4 bg-green-900/20 p-3 rounded-xl border border-green-500/30">
                  <span className="text-[10px] text-green-400 font-bold">套票客數: <span className="text-white text-sm ml-1">{selectedStaffDetail.dynamicTierStats.scalpClientCount}</span></span>
                  <span className="text-[10px] text-green-400 font-bold">頭皮總績: <span className="text-white text-sm ml-1">${selectedStaffDetail.dynamicTierStats.combinedRevenue}</span></span>
                  <span className="text-[10px] text-[#D4AF37] font-bold border-l border-green-500/50 pl-4">當前套票: <span className="text-white text-sm ml-1">{selectedStaffDetail.dynamicTierStats.finalScalpPct}%</span></span>
                  <span className="text-[10px] text-[#D4AF37] font-bold">當前產品: <span className="text-white text-sm ml-1">{selectedStaffDetail.dynamicTierStats.finalProdPct}%</span></span>
                </div>
              )}
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
                        {item.type === 'assistant_bonus' ? (
                          <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">💰 助手獎金</span>
                        ) : (
                          <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-bold uppercase">{item.commCode} {globalLabels[item.commCode] ? `(${globalLabels[item.commCode]})` : ''}</span>
                        )}
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
                      <p className="text-[9px] text-[#D4AF37] uppercase tracking-widest mb-1">實得金額</p>
                      <p className="text-lg font-black text-[#D4AF37] font-mono">
                        ${item.commission.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🟢 Admin 專屬錯單編輯彈窗 */}
      {editingTx && (
        <div className="fixed inset-0 bg-black/90 z-[80] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-md rounded-[32px] p-8 border border-blue-500/30 shadow-2xl relative animate-fade-in">
            <button onClick={() => setEditingTx(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition">
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
            <h2 className="text-2xl font-black text-white italic mb-6">Edit <span className="text-blue-500">Transaction</span></h2>
            
            <form onSubmit={handleUpdateTransaction} className="space-y-5">
              <div className="p-4 bg-white/5 rounded-xl border border-white/5 mb-4">
                 <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">單據建立時間</p>
                 <p className="text-sm font-mono text-gray-300">{new Date(editingTx.timestamp).toLocaleString('zh-HK')}</p>
              </div>

              {editingTx.type !== 'assistant_bonus' && (
                <div className="space-y-1">
                  <label className="text-[10px] text-blue-400 font-bold uppercase tracking-widest ml-1">修改服務項目</label>
                  <select 
                    required 
                    value={editingTx.service || editingTx.packageName || ''} 
                    onChange={(e) => {
                      if (editingTx.packageName !== undefined) {
                          setEditingTx({...editingTx, packageName: e.target.value});
                      } else {
                          setEditingTx({...editingTx, service: e.target.value});
                      }
                    }}
                    className="w-full bg-black border border-blue-500/30 p-3 rounded-xl text-white outline-none focus:border-blue-500 text-sm font-bold"
                  >
                    <option value="" disabled>請選擇正確項目</option>
                    {servicesData.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    {packagesData.map(p => <option key={p.id} value={p.name}>{p.name} (套票)</option>)}
                    {!servicesData.find(s => s.name === editingTx.service) && !packagesData.find(p => p.name === editingTx.packageName) && (
                      <option value={editingTx.service || editingTx.packageName}>{editingTx.service || editingTx.packageName}</option>
                    )}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-blue-400 font-bold uppercase tracking-widest ml-1">修改{editingTx.type === 'assistant_bonus' ? '獎金金額' : '結帳金額'} (HKD)</label>
                <input 
                  type="number" 
                  required 
                  value={editingTx.type === 'assistant_bonus' ? (editingTx.bonusAmount || 0) : (editingTx.amount || 0)} 
                  onChange={(e) => {
                    if (editingTx.type === 'assistant_bonus') {
                      setEditingTx({...editingTx, bonusAmount: e.target.value});
                    } else {
                      setEditingTx({...editingTx, amount: e.target.value});
                    }
                  }}
                  className="w-full bg-black border border-blue-500/30 p-3 rounded-xl text-white outline-none focus:border-blue-500 text-lg font-mono font-bold" 
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-blue-400 font-bold uppercase tracking-widest ml-1">修改{editingTx.type === 'assistant_bonus' ? '助手名稱' : '負責設計師'}</label>
                <input 
                  type="text" 
                  required 
                  value={editingTx.stylist || ''} 
                  onChange={(e) => setEditingTx({...editingTx, stylist: e.target.value})}
                  className="w-full bg-black border border-blue-500/30 p-3 rounded-xl text-white outline-none focus:border-blue-500" 
                  placeholder={editingTx.type === 'assistant_bonus' ? "輸入正確的助手名字" : "輸入正確的設計師名字"}
                />
              </div>

              <button 
                type="submit" 
                disabled={isUpdatingTx}
                className="w-full bg-blue-600 text-white font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-blue-500 transition-all shadow-lg disabled:opacity-50 mt-4"
              >
                {isUpdatingTx ? '處理中...' : '💾 強制覆寫單據並記錄全域日誌'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 🟢 Admin 專屬：審計查帳彈窗 */}
      {viewingHistoryTx && (
        <div className="fixed inset-0 bg-black/90 z-[90] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-lg max-h-[80vh] overflow-y-auto custom-scrollbar rounded-[32px] p-8 border border-purple-500/30 shadow-2xl relative animate-fade-in">
            <button onClick={() => setViewingHistoryTx(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition">
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
            <h2 className="text-2xl font-black text-white italic mb-2">Audit <span className="text-purple-500">History</span></h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-6">單據修改軌跡紀錄 (由新到舊)</p>
            
            <div className="space-y-4">
              {viewingHistoryTx.editHistory.slice().reverse().map((log, index) => (
                <div key={index} className="p-5 bg-white/5 rounded-2xl border border-white/10 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50"></div>
                  
                  <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-3">
                    <span className="text-xs text-purple-400 font-bold tracking-widest flex items-center gap-2">
                      <i className="fa-solid fa-user-shield"></i> {log.editedBy}
                    </span>
                    <span className="text-[10px] font-mono text-gray-400 bg-black/50 px-2 py-1 rounded">
                      {new Date(log.editedAt).toLocaleString('zh-HK')}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                    <div className="bg-red-950/20 p-3 rounded-xl border border-red-500/10">
                      <p className="text-red-400 font-bold mb-2 uppercase tracking-widest text-[9px]"><i className="fa-solid fa-arrow-left"></i> 修改前 (Old)</p>
                      <p className="text-gray-400 line-through mb-1">${log.oldAmount}</p>
                      <p className="text-gray-400 line-through truncate mb-1" title={log.oldService}>{log.oldService}</p>
                      <p className="text-gray-400 line-through">{log.oldStylist}</p>
                    </div>
                    <div className="bg-green-950/20 p-3 rounded-xl border border-green-500/10">
                      <p className="text-green-400 font-bold mb-2 uppercase tracking-widest text-[9px]">修改後 (New) <i className="fa-solid fa-arrow-right"></i></p>
                      <p className="text-white font-bold mb-1">${log.newAmount}</p>
                      <p className="text-gray-200 truncate mb-1" title={log.newService}>{log.newService}</p>
                      <p className="text-gray-200">{log.newStylist}</p>
                    </div>
                  </div>
                </div>
              ))}
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
        .custom-month-input { position: relative; }
        .custom-month-input::-webkit-calendar-picker-indicator {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;
        }
      `}</style>
    </div>
  );
}
