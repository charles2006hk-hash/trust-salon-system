"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, runTransaction, onSnapshot, addDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth'; 
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function SmartPOS() {
  const router = useRouter();
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [showBranchModal, setShowBranchModal] = useState(false);

  const [activeSessions, setActiveSessions] = useState([]); 
  const [appointments, setAppointments] = useState([]); 
  const [rawStaff, setRawStaff] = useState([]); 
  const [services, setServices] = useState([]); 
  const [tiers, setTiers] = useState([]); 
  const [packages, setPackages] = useState([]); 
  const [globalSettings, setGlobalSettings] = useState({ validityDays: 365 }); 

  const [phone, setPhone] = useState('+852'); // 🟢 預設帶出區碼
  const [walkInStylist, setWalkInStylist] = useState('');
  const [walkInService, setWalkInService] = useState('');

  const [checkoutSession, setCheckoutSession] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [cart, setCart] = useState([]);
  const [addItemMode, setAddItemMode] = useState('pay'); 
  const [newItemName, setNewItemName] = useState('');
  const [newItemStylist, setNewItemStylist] = useState('');
  const [newItemGrids, setNewItemGrids] = useState(1);

  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPhone, setTopUpPhone] = useState('+852');
  const [topUpUser, setTopUpUser] = useState(null);
  const [topUpTab, setTopUpTab] = useState('tdollar'); 
  const [topUpForm, setTopUpForm] = useState({ amount: '', paymentMethod: 'Cash', packageId: '' });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => { 
      if (!user) {
        router.push('/login'); 
      } else {
        try {
          const docSnap = await getDoc(doc(db, 'users', user.uid));
          if (docSnap.exists()) setCurrentUserRole(docSnap.data().role);
        } catch(e) { console.error(e); }
      }
    });
    
    const savedBranch = localStorage.getItem('pos_branch');
    if (savedBranch) setCurrentBranch(savedBranch);
    
    const unsubActive = onSnapshot(collection(db, "active_sessions"), (snap) => {
      setActiveSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const today = new Date().toISOString().split('T')[0];
    const qApp = query(collection(db, "appointments"), where("date", "==", today), where("status", "==", "pending"));
    const unsubApp = onSnapshot(qApp, (snap) => {
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    fetchBasicData();
    return () => { unsubscribe(); unsubActive(); unsubApp(); };
  }, []);

  const fetchBasicData = async () => {
    const safeGet = async (colName) => {
      try { return await getDocs(collection(db, colName)); } 
      catch (e) { return { docs: [] }; }
    };

    const [sSnap, svSnap, tSnap, pSnap, setSnap, bSnap] = await Promise.all([
      safeGet('staff'), safeGet('services'), safeGet('tiers'), safeGet('packages'), safeGet('settings'), safeGet('branches')
    ]);
    
    const branchList = bSnap.docs.map(d => d.data().name);
    setBranches(branchList);
    if (!localStorage.getItem('pos_branch') && branchList.length > 0) {
      setShowBranchModal(true);
    }

    try {
      const qStaff = query(collection(db, 'users'), where('role', 'in', ['staff', 'manager', 'admin']));
      const uSnap = await getDocs(qStaff);
      const userStaff = uSnap.docs.map(d => d.data());
      const cmsStaff = sSnap.docs.map(d => d.data());
      setRawStaff([...cmsStaff, ...userStaff]); 
    } catch(e) {
      setRawStaff(sSnap.docs.map(d => d.data())); 
    }

    const svData = svSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pkData = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    setServices([...svData, ...pkData]); 
    setPackages(pkData); 
    
    const tData = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    tData.sort((a, b) => Number(b.threshold) - Number(a.threshold)); 
    setTiers(tData);

    const settingsDoc = setSnap.docs.find(d => d.id === 'global_config');
    if (settingsDoc) setGlobalSettings({ validityDays: Number(settingsDoc.data().validityDays) || 365 });
  };

  const handleSignOut = async () => {
    if(!window.confirm("確定要登出並清除這台裝置的權限嗎？")) return;
    try {
      await signOut(auth);
      localStorage.removeItem('pos_branch'); 
      setCurrentUserRole(null);
      router.push('/login');
    } catch(e) { toast.error("登出失敗"); }
  };

  const selectBranch = (branchName) => {
    setCurrentBranch(branchName);
    localStorage.setItem('pos_branch', branchName);
    setShowBranchModal(false);
    toast.success(`已切換至 ${branchName} 收銀模式`);
  };

  const displayStaff = [...new Set(
    rawStaff.filter(s => s.branch === currentBranch || s.branch === 'ALL').map(s => s.name)
  )].filter(Boolean);

  const displayServices = services.filter(s => !s.branch || s.branch === 'ALL' || s.branch === currentBranch);
  const displayPackages = packages.filter(p => !p.branch || p.branch === 'ALL' || p.branch === currentBranch);

  const displaySessions = activeSessions.filter(s => s.branch === currentBranch || !s.branch);
  const displayAppointments = appointments.filter(a => a.branch === currentBranch || !a.branch);

  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleCheckIn(phone); } };

  const handleCheckIn = async (phoneNum, bookingData = null) => {
    if (!currentBranch) return toast.error("請先選擇營業門市");
    if (!phoneNum || phoneNum.length < 8) return toast.error("請輸入有效電話");
    if (!bookingData && (!walkInStylist || !walkInService)) return toast.error("請選擇髮型師與服務項目");

    const formattedPhone = phoneNum.startsWith('+') ? phoneNum : `+852${phoneNum}`;
    try {
      await addDoc(collection(db, "active_sessions"), {
        phoneNumber: formattedPhone, stylist: bookingData?.stylist || walkInStylist, service: bookingData?.service || walkInService, startTime: new Date().toISOString(), bookingId: bookingData?.id || null, branch: currentBranch 
      });
      if (bookingData?.id) { const appRef = doc(db, "appointments", bookingData.id); await runTransaction(db, async (tx) => { tx.update(appRef, { status: "checked-in" }); }); }
      toast.success(`${formattedPhone} 已入店服務`);
      setPhone('+852'); setWalkInStylist(''); setWalkInService('');
    } catch (e) { toast.error("報到失敗"); }
  };

  const openCheckout = async (session) => {
    const toastId = toast.loading("正在載入結帳單...");
    try {
      const userQ = query(collection(db, "users"), where("phoneNumber", "==", session.phoneNumber));
      const userSnap = await getDocs(userQ);
      
      const uData = userSnap.empty ? { discount: 1, tier: '非會員 (Walk-in)', tDollarBalance: 0, packageBalances: {} } : userSnap.docs[0].data();
      const serviceItem = services.find(s => s.name === session.service);
      const originalPrice = serviceItem ? Number(serviceItem.price) : 0;
      const discountRate = Number(uData.discount) || 1;
      const finalPrice = Math.round(originalPrice * discountRate);

      setCheckoutSession({
        ...session, discountRate, tier: uData.tier || '基本會員', balance: uData.tDollarBalance || 0, userId: userSnap.empty ? null : userSnap.docs[0].id, packageBalances: uData.packageBalances || {}
      });

      setCart([{ id: Date.now().toString(), type: 'pay', name: session.service, stylist: session.stylist, originalPrice, finalPrice, grids: 0 }]);
      setAddItemMode('pay'); setNewItemName(''); setNewItemStylist(''); setNewItemGrids(1);
      toast.dismiss(toastId);
    } catch (error) { toast.error("讀取帳單失敗", { id: toastId }); }
  };

  const handleAddToCart = () => {
    if (!newItemName) return toast.error("請選擇項目");
    const itemStylist = newItemStylist || checkoutSession.stylist; 

    if (addItemMode === 'pay') {
      const sItem = services.find(s => s.name === newItemName);
      if (!sItem) return toast.error("項目不存在");
      const orig = Number(sItem.price);
      const fin = Math.round(orig * checkoutSession.discountRate);
      setCart([...cart, { id: Date.now().toString(), type: 'pay', name: newItemName, stylist: itemStylist, originalPrice: orig, finalPrice: fin, grids: 0 }]);
    } else {
      setCart([...cart, { id: Date.now().toString(), type: 'deduct', name: newItemName, stylist: itemStylist, originalPrice: 0, finalPrice: 0, grids: Number(newItemGrids) }]);
    }
    setNewItemName(''); setNewItemGrids(1);
  };

  const removeFromCart = (id) => setCart(cart.filter(item => item.id !== id));

  // 🟢 支援自訂折扣：更新購物車內項目的金額
  const updateCartItemPrice = (id, newPrice) => {
    setCart(cart.map(item => item.id === id ? { ...item, finalPrice: newPrice } : item));
  };

  const processSettlement = async (e) => {
    e.preventDefault();
    if (!currentBranch) return toast.error("系統錯誤：未綁定門市");
    if (cart.length === 0) return toast.error("購物車不能為空");

    setIsProcessing(true);
    const toastId = toast.loading('綜合結帳處理中...');
    
    let totalPay = 0; let deductMap = {}; 
    cart.forEach(item => {
      if (item.type === 'pay') totalPay += item.finalPrice;
      if (item.type === 'deduct') deductMap[item.name] = (deductMap[item.name] || 0) + item.grids;
    });

    try {
      if (checkoutSession.userId) {
        const userRef = doc(db, "users", checkoutSession.userId);
        await runTransaction(db, async (tx) => {
          const uDoc = await tx.get(userRef);
          const currentData = uDoc.data();

          if (totalPay > 0) {
            const newBal = (currentData.tDollarBalance || 0) - totalPay;
            if (newBal < 0) throw new Error(`T-Dollar 餘額不足！當前僅剩 $${currentData.tDollarBalance}`);
            tx.update(userRef, { tDollarBalance: newBal });
          }

          let newPackageBalances = { ...(currentData.packageBalances || {}) };
          for (const [pkgName, grids] of Object.entries(deductMap)) {
            const currentGrids = newPackageBalances[pkgName] || 0;
            if (currentGrids < grids) throw new Error(`套票【${pkgName}】格數不足！剩餘 ${currentGrids} 格`);
            newPackageBalances[pkgName] = currentGrids - grids;
          }
          if (Object.keys(deductMap).length > 0) tx.update(userRef, { packageBalances: newPackageBalances });

          cart.forEach(item => {
             const newTxRef = doc(collection(db, "transactions"));
             if (item.type === 'pay') {
               tx.set(newTxRef, { branch: currentBranch, userId: userRef.id, phoneNumber: checkoutSession.phoneNumber, amount: item.finalPrice, originalAmount: item.originalPrice, discountRate: checkoutSession.discountRate, service: item.name, stylist: item.stylist, type: "deduct", timestamp: new Date().toISOString() });
             } else {
               tx.set(newTxRef, { branch: currentBranch, userId: userRef.id, phoneNumber: checkoutSession.phoneNumber, amount: 0, service: item.name, stylist: item.stylist, type: "deduct_package", packageName: item.name, deductedGrids: item.grids, timestamp: new Date().toISOString() });
             }
          });
          tx.delete(doc(db, "active_sessions", checkoutSession.id));
        });
      } else {
        if (Object.keys(deductMap).length > 0) throw new Error("非會員無法扣除套票");
        await runTransaction(db, async (tx) => {
          cart.forEach(item => {
            const newTxRef = doc(collection(db, "transactions"));
            tx.set(newTxRef, { branch: currentBranch, phoneNumber: checkoutSession.phoneNumber, amount: item.finalPrice, service: item.name, stylist: item.stylist, type: "walkin_cash", timestamp: new Date().toISOString() });
          });
          tx.delete(doc(db, "active_sessions", checkoutSession.id));
        });
      }

      toast.success("結帳完成，業績已分發！", { id: toastId });
      setCheckoutSession(null);
    } catch (e) { toast.error(e.message, { id: toastId }); } finally { setIsProcessing(false); }
  };

  const cancelSession = async (sessionId) => {
    if (!window.confirm("確定要取消此服務嗎？\n這將會直接釋放髮型師，且不會扣除客人任何款項。")) return;
    try { await deleteDoc(doc(db, "active_sessions", sessionId)); toast.success("服務已取消"); } catch (e) { toast.error("取消失敗"); }
  };

  const searchTopUpUser = async () => {
    if(!topUpPhone) return;
    const q = query(collection(db, "users"), where("phoneNumber", "==", topUpPhone));
    const snap = await getDocs(q);
    if (!snap.empty) setTopUpUser({ id: snap.docs[0].id, ...snap.docs[0].data() }); else toast.error("找不到此會員");
  };

  const handleStoreAction = async (e) => {
    e.preventDefault();
    if (!currentBranch) return toast.error("系統錯誤：未綁定門市");
    if (!topUpUser) return;
    try {
      const userRef = doc(db, 'users', topUpUser.id);
      const newExpiry = new Date(Date.now() + globalSettings.validityDays * 24 * 60 * 60 * 1000).toISOString();

      if (topUpTab === 'tdollar') {
        if (!topUpForm.amount || isNaN(topUpForm.amount) || topUpForm.amount <= 0) return toast.error("請輸入有效充值金額");
        const paidHKD = Number(topUpForm.amount);
        const newTotalTopUp = (topUpUser.totalTopUp || 0) + paidHKD;
        
        let newTier = { name: '基本會員 (Basic)', discount: 1, upgradeBonus: 0, giftPackageName: '' };
        for (const t of tiers) { if (newTotalTopUp >= Number(t.threshold)) { newTier = t; break; } }

        let upgradeBonus = 0; let giftPkgName = ''; let giftPkgGrids = 0; let isUpgraded = false;
        if (newTier.name !== (topUpUser.tier || '基本會員 (Basic)') && newTier.name !== '基本會員 (Basic)') {
            isUpgraded = true; upgradeBonus = Number(newTier.upgradeBonus) || 0;
            if (newTier.giftPackageName) { giftPkgName = newTier.giftPackageName; const pkgData = packages.find(p => p.name === giftPkgName); if (pkgData) giftPkgGrids = Number(pkgData.quantity); }
        }

        if (!window.confirm(`確認收取 ${topUpForm.paymentMethod} $${paidHKD}？\n\n結算後等級：${newTier.name} (${newTier.discount * 10} 折)`)) return;

        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          const newBalance = (userDoc.data().tDollarBalance || 0) + paidHKD;
          const newPoints = (userDoc.data().points || 0) + paidHKD + upgradeBonus;
          let newPackageBalances = userDoc.data().packageBalances || {};
          if (giftPkgGrids > 0) newPackageBalances = { ...newPackageBalances, [giftPkgName]: (newPackageBalances[giftPkgName] || 0) + giftPkgGrids };

          transaction.update(userRef, { tDollarBalance: newBalance, points: newPoints, totalTopUp: newTotalTopUp, tier: newTier.name, discount: newTier.discount, tDollarExpiry: newExpiry, packageBalances: newPackageBalances, status: 'active' });
          transaction.set(doc(collection(db, "transactions")), { branch: currentBranch, userId: topUpUser.id, phoneNumber: topUpUser.phoneNumber, type: "topup", tDollarAdded: paidHKD, pointsAdded: paidHKD + upgradeBonus, upgradeBonusAdded: upgradeBonus, giftPackageAdded: giftPkgName, amountPaidHKD: paidHKD, paymentMethod: topUpForm.paymentMethod, timestamp: new Date().toISOString() });
        });
        toast.success(`增值成功！已將客人升級至 ${newTier.name}`);

      } else if (topUpTab === 'package') {
        const pkg = packages.find(p => p.id === topUpForm.packageId);
        if (!pkg) return toast.error("請選擇套票");
        const paidHKD = Number(pkg.price);
        if (!window.confirm(`確認收取 ${topUpForm.paymentMethod} $${paidHKD} 售出【${pkg.name}】？`)) return;

        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          const currentPkgs = userDoc.data().packageBalances || {};
          const newQuantity = (currentPkgs[pkg.name] || 0) + Number(pkg.quantity);
          transaction.update(userRef, { packageBalances: { ...currentPkgs, [pkg.name]: newQuantity }, tDollarExpiry: newExpiry });
          transaction.set(doc(collection(db, "transactions")), { branch: currentBranch, userId: topUpUser.id, phoneNumber: topUpUser.phoneNumber, type: "buy_package", packageName: pkg.name, gridsAdded: pkg.quantity, amountPaidHKD: paidHKD, paymentMethod: topUpForm.paymentMethod, timestamp: new Date().toISOString() });
        });
        toast.success(`成功售出套票：${pkg.name}`);
      }
      setShowTopUpModal(false); setTopUpUser(null); setTopUpPhone('+852'); setTopUpForm({ amount: '', paymentMethod: 'Cash', packageId: '' });
    } catch (error) { toast.error("操作失敗"); }
  };

  // 🟢 內建 POS 小鍵盤組件
  const handleKeypadPress = (key, stateValue, setState) => {
    if (key === 'C') {
      setState(stateValue.length > 4 ? stateValue.slice(0, -1) : '+852');
    } else {
      setState(stateValue + key);
    }
  };

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-6 font-sans">
      <Toaster position="top-right" />

      {showBranchModal && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-6 backdrop-blur-md">
           <div className="bg-[#121212] w-full max-w-md rounded-[40px] p-10 border border-[#D4AF37]/50 shadow-[0_0_50px_rgba(212,175,55,0.2)] text-center animate-fade-in">
              <i className="fa-solid fa-store text-5xl text-[#D4AF37] mb-6"></i>
              <h2 className="text-2xl font-black text-white mb-2">請選擇營業門市</h2>
              <p className="text-sm text-gray-400 mb-8">此裝置的結帳與派單紀錄將歸屬於該門市</p>
              
              <div className="space-y-3">
                {branches.length === 0 ? (
                   <p className="text-red-400 font-bold text-sm bg-red-500/10 p-4 rounded-2xl">請先由老闆至 CMS 系統建立「門店資料」</p>
                ) : (
                  branches.map(b => (
                    <button key={b} onClick={() => selectBranch(b)} className="w-full bg-white/5 border border-white/10 hover:bg-[#D4AF37] hover:text-black hover:border-[#D4AF37] text-white font-bold py-4 rounded-2xl transition-all shadow-lg flex justify-between items-center px-6 group">
                      <span className="tracking-widest uppercase">{b}</span>
                      <i className="fa-solid fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity"></i>
                    </button>
                  ))
                )}
              </div>
           </div>
        </div>
      )}
      
      <header className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter flex items-center gap-3">
            <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg">TRUST</span> 收銀與派單系統
          </h1>
          <div className="mt-3 flex items-center gap-3">
            <span className="bg-blue-600/20 border border-blue-500/50 text-blue-400 px-3 py-1 rounded-md text-xs font-bold uppercase tracking-widest">
              <i className="fa-solid fa-location-dot mr-1"></i> {currentBranch || '未選門市'}
            </span>
            {['admin', 'manager'].includes(currentUserRole) && (
              <button onClick={() => setShowBranchModal(true)} className="text-[10px] text-gray-500 hover:text-white underline underline-offset-2 transition-colors">
                切換門市
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
           <button onClick={handleSignOut} className="text-gray-400 hover:text-white bg-white/5 hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 px-4 py-3 rounded-xl text-xs font-bold transition-all uppercase tracking-widest flex items-center gap-2">
              <i className="fa-solid fa-power-off"></i> 安全登出
           </button>

           <button onClick={() => setShowTopUpModal(true)} className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-green-900/50">
             <i className="fa-solid fa-hand-holding-dollar"></i> 客席增值 / 售票
           </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-[#121212] p-8 rounded-[40px] border border-white/5 shadow-2xl">
            <h3 className="text-xs font-black text-[#D4AF37] uppercase tracking-widest mb-6 italic">Quick Check-in (掃碼/路過)</h3>
            <div className="space-y-4">
                <input 
                    type="tel" 
                    value={phone} 
                    onChange={e => setPhone(e.target.value)}
                    onKeyDown={handleKeyDown}
                    inputMode="numeric" // 🟢 iPad 會彈出數字鍵盤
                    className="w-full bg-black border border-white/10 p-4 rounded-2xl text-xl font-bold text-white outline-none focus:border-[#D4AF37] placeholder:text-gray-700"
                    placeholder="請輸入電話..."
                />
                
                {/* 🟢 內建實體化 POS 觸控數字盤 */}
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleKeypadPress(key, phone, setPhone)}
                      className="bg-white/5 hover:bg-[#D4AF37] hover:text-black text-gray-300 font-bold py-3 rounded-xl transition-colors text-lg shadow-inner border border-white/5 active:scale-95"
                    >
                      {key === 'C' ? <i className="fa-solid fa-delete-left text-red-400"></i> : key}
                    </button>
                  ))}
                  {/* 第 12 個按鈕直接作為「送出報到」 */}
                  <button onClick={() => handleCheckIn(phone)} className="bg-[#D4AF37] text-black font-black py-3 rounded-xl transition-all shadow-xl active:scale-95">
                    GO <i className="fa-solid fa-arrow-right ml-1"></i>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <select value={walkInStylist} onChange={e => setWalkInStylist(e.target.value)} className="w-full bg-black border border-white/10 p-3 rounded-xl text-sm text-gray-400 outline-none">
                    <option value="">選擇髮型師</option>
                    {displayStaff.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={walkInService} onChange={e => setWalkInService(e.target.value)} className="w-full bg-black border border-white/10 p-3 rounded-xl text-sm text-gray-400 outline-none">
                    <option value="">選擇項目</option>
                    {displayServices.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest px-4">本門市今日預約客</h3>
            {displayAppointments.length === 0 ? (
                <div className="p-8 text-center text-gray-700 border border-dashed border-white/5 rounded-[32px]">目前無待報到預約</div>
            ) : displayAppointments.map(app => (
                <div key={app.id} onClick={() => handleCheckIn(app.phoneNumber, app)} className="bg-[#121212]/50 p-6 rounded-[32px] border border-white/5 flex justify-between items-center cursor-pointer hover:border-[#D4AF37]/50 transition group">
                   <div>
                     <p className="text-white font-bold">{app.phoneNumber}</p>
                     <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">
                       <i className="fa-regular fa-clock mr-1"></i>{app.time} | {app.stylist} | {app.service}
                     </p>
                   </div>
                   <div className="bg-white/5 w-8 h-8 rounded-full flex items-center justify-center group-hover:bg-[#D4AF37] group-hover:text-black transition-colors">
                     <i className="fa-solid fa-arrow-right"></i>
                   </div>
                </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <h3 className="text-xs font-black text-[#D4AF37] uppercase tracking-widest px-4">本門市現場動態 (Now Serving)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {displaySessions.map(session => (
              <div key={session.id} className="bg-[#121212] rounded-[40px] p-8 border border-white/5 relative group overflow-hidden flex flex-col justify-between min-h-[250px]">
                
                <div className="absolute top-0 right-0 p-6 text-white/5 text-5xl z-0 pointer-events-none transition-colors">
                  <i className="fa-solid fa-scissors"></i>
                </div>

                <div className="absolute top-5 right-5 z-10">
                  <button 
                    onClick={() => cancelSession(session.id)}
                    className="w-10 h-10 rounded-full bg-red-900/30 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-lg"
                    title="強制取消並釋放資源"
                  >
                    <i className="fa-solid fa-xmark text-lg"></i>
                  </button>
                </div>
                
                <div className="relative z-10">
                  <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-2">Customer</p>
                  <h4 className="text-3xl font-black text-white tracking-tighter mb-6">{session.phoneNumber}</h4>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                      <p className="text-[10px] text-gray-600 font-bold uppercase mb-1">Stylist</p>
                      <p className="text-sm font-bold text-gray-300 italic">{session.stylist}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-600 font-bold uppercase mb-1">Service</p>
                      <p className="text-sm font-bold text-gray-300">{session.service}</p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => openCheckout(session)}
                  className="relative z-10 w-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] font-black py-4 rounded-2xl text-[10px] uppercase tracking-[0.3em] hover:bg-[#D4AF37] hover:text-black transition-all"
                >
                  服務完成 ‧ 進入購物車結帳
                </button>
              </div>
            ))}
            
            {displaySessions.length === 0 && (
                <div className="col-span-2 py-32 text-center text-gray-800 font-black italic text-3xl uppercase tracking-tighter border border-dashed border-white/5 rounded-[40px]">
                    No Active Customers.
                </div>
            )}
          </div>

          <div className="mt-12 pt-8 border-t border-white/5">
            <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-[0.4em] mb-6">本門市人員負荷 (Stylist Load)</h3>
            <div className="flex flex-wrap gap-4">
               {displayStaff.length === 0 && (
                 <p className="text-xs text-gray-500">此門市尚無排班設計師。</p>
               )}
               {displayStaff.map(name => {
                 const count = displaySessions.filter(s => s.stylist === name).length;
                 return (
                   <div key={name} className={`px-6 py-3 rounded-full border flex items-center gap-3 ${count > 0 ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5 text-white' : 'border-white/5 text-gray-600 transition-all'}`}>
                      <span className={`w-2 h-2 rounded-full shadow-lg ${count >= 2 ? 'bg-red-500 shadow-red-500/50' : count === 1 ? 'bg-yellow-500 shadow-yellow-500/50' : 'bg-green-500 shadow-green-500/50'}`}></span>
                      <span className="text-sm font-black italic">{name}</span>
                      <span className="text-xs font-mono font-bold opacity-50">({count})</span>
                   </div>
                 );
               })}
            </div>
          </div>
        </div>
      </div>

      {showTopUpModal && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-lg rounded-[40px] p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative">
            <button onClick={() => {setShowTopUpModal(false); setTopUpUser(null); setTopUpPhone('+852');}} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            <h2 className="text-2xl font-black text-white italic mb-6">Store Action <span className="text-xs text-[#D4AF37] ml-2 not-italic">@{currentBranch}</span></h2>
            
            <div className="flex gap-2 mb-6">
              <input type="tel" inputMode="numeric" value={topUpPhone} onChange={e => setTopUpPhone(e.target.value)} placeholder="輸入電話..." className="flex-1 bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37]" />
              <button onClick={searchTopUpUser} className="bg-white/10 hover:bg-white/20 text-white px-6 rounded-2xl font-bold transition">搜尋</button>
            </div>

            {topUpUser && (
              <form onSubmit={handleStoreAction} className="space-y-6 border-t border-white/10 pt-6 animate-fade-in">
                
                <div className="flex gap-2 p-1 bg-black rounded-2xl border border-white/5">
                  <button type="button" onClick={() => setTopUpTab('tdollar')} className={`flex-1 py-3 rounded-xl text-xs font-bold transition-colors ${topUpTab === 'tdollar' ? 'bg-[#D4AF37] text-black' : 'text-gray-500 hover:text-white'}`}>💰 儲值 T-Dollar</button>
                  <button type="button" onClick={() => setTopUpTab('package')} className={`flex-1 py-3 rounded-xl text-xs font-bold transition-colors ${topUpTab === 'package' ? 'bg-purple-500 text-white' : 'text-gray-500 hover:text-white'}`}>🎫 售賣套票</button>
                </div>

                <div className="bg-white/5 p-4 rounded-2xl flex justify-between items-center">
                   <div>
                     <p className="text-white font-bold">{topUpUser.name || topUpUser.phoneNumber}</p>
                     <p className="text-[10px] text-gray-400 mt-1">目前等級: <span className="text-[#D4AF37] font-bold">{topUpUser.tier || '基本會員 (Basic)'}</span></p>
                   </div>
                   <div className="text-right">
                     <p className="text-[10px] text-gray-500 font-bold uppercase">累積儲值</p>
                     <p className="text-white font-bold">${topUpUser.totalTopUp || 0}</p>
                   </div>
                </div>

                {topUpTab === 'tdollar' ? (
                  <div className="space-y-2 animate-fade-in">
                    <label className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest ml-1">充值金額 (HKD) - 1:1 兌換 T-Dollar</label>
                    <div className="flex gap-2 mb-2">
                      {[1000, 3000, 5000].map(amt => (
                        <button key={amt} type="button" onClick={() => setTopUpForm({...topUpForm, amount: amt})} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-xl text-white text-xs font-bold transition">${amt}</button>
                      ))}
                    </div>
                    <input type="number" inputMode="decimal" required value={topUpForm.amount} onChange={e => setTopUpForm({...topUpForm, amount: e.target.value})} className="w-full bg-black border border-[#D4AF37]/50 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37]" placeholder="手動輸入金額..." />
                  </div>
                ) : (
                  <div className="space-y-2 animate-fade-in">
                    <label className="text-[10px] font-bold text-purple-400 uppercase tracking-widest ml-1">選擇套票方案</label>
                    <select required value={topUpForm.packageId} onChange={e => setTopUpForm({...topUpForm, packageId: e.target.value})} className="w-full bg-black border border-purple-500/50 p-4 rounded-2xl text-white outline-none focus:border-purple-400">
                      <option value="">請選擇...</option>
                      {displayPackages.map(p => <option key={p.id} value={p.id}>{p.name} - ${p.price} ({p.quantity}格)</option>)}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">收款方式</label>
                  <select value={topUpForm.paymentMethod} onChange={e => setTopUpForm({...topUpForm, paymentMethod: e.target.value})} className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37]">
                    <option value="Cash">現金 (Cash)</option>
                    <option value="Credit Card">信用卡 (Visa/Master)</option>
                    <option value="PayMe">PayMe</option>
                    <option value="FPS">轉數快 (FPS)</option>
                    <option value="Alipay">支付寶 (Alipay)</option>
                  </select>
                </div>

                <button type="submit" className={`w-full font-black py-4 rounded-2xl uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl ${topUpTab === 'tdollar' ? 'bg-[#D4AF37] text-black' : 'bg-purple-500 text-white hover:bg-purple-400'}`}>
                  確認收款並存入系統
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {checkoutSession && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-6 backdrop-blur-md overflow-y-auto">
          <div className="bg-[#121212] w-full max-w-lg rounded-[40px] p-8 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative my-8">
            <button onClick={() => setCheckoutSession(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white">
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
            
            <h3 className="text-2xl font-black text-white italic mb-6">Cart Checkout <span className="text-xs text-[#D4AF37] ml-2 not-italic">@{currentBranch}</span></h3>
            
            <div className="bg-black p-4 rounded-2xl border border-[#D4AF37]/30 flex justify-between items-center mb-6">
              <div>
                <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Customer</p>
                <p className="text-lg font-bold text-white">{checkoutSession.phoneNumber}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] bg-[#D4AF37]/20 text-[#D4AF37] px-2 py-1 rounded-md font-bold uppercase tracking-widest block mb-1">
                  {checkoutSession.tier}
                </span>
                {checkoutSession.discountRate < 1 && (
                  <span className="text-xs text-green-400 font-bold">{checkoutSession.discountRate * 10} 折優惠</span>
                )}
              </div>
            </div>

            <div className="space-y-3 mb-6 bg-white/5 p-4 rounded-2xl border border-white/5">
               <h4 className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-2 border-b border-white/10 pb-2">
                 已加入的消費清單 ({cart.length})
               </h4>
               
               {cart.length === 0 && <p className="text-sm text-gray-500 text-center py-4">購物車為空</p>}
               
               {cart.map(item => (
                 <div key={item.id} className="flex justify-between items-center bg-black p-3 rounded-xl border border-white/5 group">
                   <div>
                     <p className="text-sm font-bold text-white leading-tight">{item.name}</p>
                     <div className="flex items-center gap-2 mt-1">
                       <span className="text-[10px] text-gray-500 italic"><i className="fa-solid fa-scissors mr-1"></i>{item.stylist}</span>
                       {item.type === 'deduct' && <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 rounded uppercase">扣抵套票</span>}
                     </div>
                   </div>
                   <div className="flex items-center gap-4">
                     <div className="text-right">
                       {/* 🟢 核心功能：可以直接修改金額！支援自訂折扣！ */}
                       {item.type === 'pay' ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[#D4AF37] font-bold">$</span>
                            <input 
                              type="number" 
                              inputMode="decimal"
                              min="0"
                              className="w-20 bg-black border border-[#D4AF37]/50 text-[#D4AF37] font-bold text-right p-1 rounded-lg outline-none focus:border-[#D4AF37] transition-colors" 
                              value={item.finalPrice} 
                              onChange={(e) => updateCartItemPrice(item.id, Number(e.target.value))} 
                              title="可手動修改金額給予額外折扣"
                            />
                          </div>
                       ) : (
                          <p className="text-purple-400 font-bold">-{item.grids} 格</p>
                       )}
                     </div>
                     <button type="button" onClick={() => removeFromCart(item.id)} className="w-8 h-8 rounded-full bg-red-900/30 text-red-500 hover:bg-red-500 hover:text-white transition-colors flex justify-center items-center">
                       <i className="fa-solid fa-trash text-xs"></i>
                     </button>
                   </div>
                 </div>
               ))}
               
               <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                 <div className="text-purple-400 text-xs font-bold">
                    {cart.filter(i => i.type === 'deduct').length > 0 && `共扣除 ${cart.filter(i => i.type === 'deduct').reduce((a, b) => a + b.grids, 0)} 格`}
                 </div>
                 <div className="text-right">
                   <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-1">應付總額 (T-Dollar / Cash)</p>
                   <p className="text-3xl font-black text-white">${cart.filter(i => i.type === 'pay').reduce((a, b) => a + b.finalPrice, 0)}</p>
                 </div>
               </div>
            </div>

            <div className="bg-black border border-dashed border-gray-700 p-4 rounded-2xl mb-6">
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-3">➕ 繼續加購項目</h4>
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={() => setAddItemMode('pay')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${addItemMode === 'pay' ? 'bg-white/20 text-white' : 'text-gray-500 hover:bg-white/5'}`}>
                  💰 收費項目
                </button>
                {checkoutSession.userId && (
                  <button type="button" onClick={() => setAddItemMode('deduct')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${addItemMode === 'deduct' ? 'bg-purple-500/30 text-purple-300' : 'text-gray-500 hover:bg-white/5'}`}>
                    🎫 扣抵套票
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                {addItemMode === 'pay' ? (
                  <select className="col-span-2 w-full bg-[#121212] border border-white/10 p-3 rounded-xl text-white outline-none text-sm focus:border-[#D4AF37]" value={newItemName} onChange={e => setNewItemName(e.target.value)}>
                    <option value="">選擇服務或產品...</option>
                    {displayServices.map(s => <option key={s.id} value={s.name}>{s.name} (${s.price})</option>)}
                  </select>
                ) : (
                  <>
                    <select className="col-span-2 w-full bg-[#121212] border border-purple-500/30 p-3 rounded-xl text-white outline-none text-sm focus:border-purple-400" value={newItemName} onChange={e => setNewItemName(e.target.value)}>
                      <option value="">選擇客人可用的套票...</option>
                      {Object.entries(checkoutSession.packageBalances || {}).filter(([_, g]) => g > 0).map(([n, g]) => <option key={n} value={n}>{n} (剩餘 {g} 格)</option>)}
                    </select>
                    <div className="col-span-2 flex items-center gap-3">
                       <span className="text-xs text-gray-400 w-16">扣除數量</span>
                       <input type="number" inputMode="decimal" min="1" className="flex-1 bg-[#121212] border border-purple-500/30 p-3 rounded-xl text-white outline-none text-sm text-center font-bold" value={newItemGrids} onChange={e => setNewItemGrids(e.target.value)} />
                    </div>
                  </>
                )}
                
                <select className="col-span-2 w-full bg-[#121212] border border-white/10 p-3 rounded-xl text-white outline-none text-sm" value={newItemStylist} onChange={e => setNewItemStylist(e.target.value)}>
                  <option value="">選擇負責此項目的髮型師 (預設: {checkoutSession.stylist})</option>
                  {displayStaff.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button type="button" onClick={handleAddToCart} className="w-full border border-gray-600 text-gray-300 py-3 rounded-xl text-xs font-bold hover:bg-white hover:text-black transition">
                ➕ 加入購物車清單
              </button>
            </div>

            <form onSubmit={processSettlement}>
              {checkoutSession.userId && <p className="text-[10px] text-gray-500 text-center mb-2">該會員目前 T-Dollar 餘額: <span className="text-[#D4AF37] font-bold">${checkoutSession.balance}</span></p>}
              {!checkoutSession.userId && <p className="text-[10px] text-red-400 text-center mb-2 bg-red-500/10 py-1 rounded">此客為非會員(Walk-in)，請向客人收取現金或刷卡</p>}
              <button type="submit" disabled={isProcessing || cart.length === 0} className={`w-full font-black py-4 rounded-2xl uppercase tracking-widest text-sm transition-all shadow-xl bg-[#D4AF37] text-black hover:scale-105 disabled:opacity-30 disabled:hover:scale-100`}>
                {isProcessing ? "Processing..." : "確認綜合結帳"}
              </button>
            </form>

          </div>
        </div>
      )}

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.3s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
