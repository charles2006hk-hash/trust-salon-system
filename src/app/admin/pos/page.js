"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, runTransaction, onSnapshot, addDoc, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function SmartPOS() {
  const router = useRouter();
  
  const [activeSessions, setActiveSessions] = useState([]); 
  const [appointments, setAppointments] = useState([]); 
  const [staff, setStaff] = useState([]); 
  const [services, setServices] = useState([]); 
  const [tiers, setTiers] = useState([]); 
  const [packages, setPackages] = useState([]); 
  const [globalSettings, setGlobalSettings] = useState({ validityDays: 365 }); // 🟢 抓取全局有效天數

  const [phone, setPhone] = useState('');
  const [walkInStylist, setWalkInStylist] = useState('');
  const [walkInService, setWalkInService] = useState('');

  const [checkoutSession, setCheckoutSession] = useState(null);
  const [checkoutAmount, setCheckoutAmount] = useState(''); 
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [checkoutMethod, setCheckoutMethod] = useState('tdollar'); 
  const [selectedUserPackage, setSelectedUserPackage] = useState(''); 
  const [deductGrids, setDeductGrids] = useState(1);

  const [showRegModal, setShowRegModal] = useState(false);
  const [unregisteredPhone, setUnregisteredPhone] = useState('');

  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPhone, setTopUpPhone] = useState('');
  const [topUpUser, setTopUpUser] = useState(null);
  
  const [topUpTab, setTopUpTab] = useState('tdollar'); 
  const [topUpForm, setTopUpForm] = useState({ amount: '', paymentMethod: 'Cash', packageId: '' });

  useEffect(() => {
    onAuthStateChanged(auth, (user) => { if (!user) router.push('/login'); });
    
    const unsubActive = onSnapshot(collection(db, "active_sessions"), (snap) => {
      setActiveSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const today = new Date().toISOString().split('T')[0];
    const qApp = query(collection(db, "appointments"), where("date", "==", today), where("status", "==", "pending"));
    const unsubApp = onSnapshot(qApp, (snap) => {
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    fetchBasicData();
    return () => { unsubActive(); unsubApp(); };
  }, []);

  const fetchBasicData = async () => {
    const [sSnap, svSnap, tSnap, pSnap, setSnap] = await Promise.all([
      getDocs(collection(db, 'staff')), 
      getDocs(collection(db, 'services')),
      getDocs(collection(db, 'tiers')),
      getDocs(collection(db, 'packages')),
      getDocs(collection(db, 'settings')) // 🟢 抓取系統全局設定
    ]);
    setStaff(sSnap.docs.map(d => d.data().name));
    setServices(svSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    
    const tData = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    tData.sort((a, b) => Number(b.threshold) - Number(a.threshold)); 
    setTiers(tData);
    
    setPackages(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    // 🟢 套用老闆在 CMS 設定的有效天數
    const settingsDoc = setSnap.docs.find(d => d.id === 'global_config');
    if (settingsDoc) setGlobalSettings({ validityDays: Number(settingsDoc.data().validityDays) || 365 });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCheckIn(phone); }
  };

  const handleCheckIn = async (phoneNum, bookingData = null) => {
    if (!phoneNum || phoneNum.length < 8) return toast.error("請輸入有效電話");
    if (!bookingData && (!walkInStylist || !walkInService)) return toast.error("請選擇髮型師與服務項目");

    const formattedPhone = phoneNum.startsWith('+') ? phoneNum : `+852${phoneNum}`;

    try {
      await addDoc(collection(db, "active_sessions"), {
        phoneNumber: formattedPhone,
        stylist: bookingData?.stylist || walkInStylist,
        service: bookingData?.service || walkInService,
        startTime: new Date().toISOString(),
        bookingId: bookingData?.id || null
      });

      if (bookingData?.id) {
        const appRef = doc(db, "appointments", bookingData.id);
        await runTransaction(db, async (tx) => { tx.update(appRef, { status: "checked-in" }); });
      }

      toast.success(`${formattedPhone} 已入店服務`);
      setPhone(''); setWalkInStylist(''); setWalkInService('');
    } catch (e) { toast.error("報到失敗"); }
  };

  const openCheckout = async (session) => {
    const toastId = toast.loading("正在結算帳單與會員折扣...");
    try {
      const userQ = query(collection(db, "users"), where("phoneNumber", "==", session.phoneNumber));
      const userSnap = await getDocs(userQ);
      
      const uData = userSnap.empty ? { discount: 1, tier: '非會員 (Walk-in)', tDollarBalance: 0, packageBalances: {} } : userSnap.docs[0].data();
      const serviceItem = services.find(s => s.name === session.service);
      const originalPrice = serviceItem ? Number(serviceItem.price) : 0;
      
      const discountRate = Number(uData.discount) || 1;
      const finalPrice = Math.round(originalPrice * discountRate);

      setCheckoutSession({
        ...session,
        originalPrice,
        discountRate,
        finalPrice,
        tier: uData.tier || '基本會員 (Basic)',
        balance: uData.tDollarBalance || 0,
        userId: userSnap.empty ? null : userSnap.docs[0].id,
        packageBalances: uData.packageBalances || {}
      });
      setCheckoutAmount(finalPrice); 
      setCheckoutMethod('tdollar'); 
      setSelectedUserPackage('');
      setDeductGrids(1);
      toast.dismiss(toastId);
    } catch (error) {
      toast.error("讀取帳單失敗", { id: toastId });
    }
  };

  const processSettlement = async (e) => {
    e.preventDefault();
    if (checkoutMethod === 'tdollar' && (!checkoutAmount || isNaN(checkoutAmount))) return toast.error("請輸入有效金額");

    setIsProcessing(true);
    const toastId = toast.loading('結帳處理中...');
    
    try {
      if (checkoutSession.userId) {
        const userRef = doc(db, "users", checkoutSession.userId);
        
        await runTransaction(db, async (tx) => {
          const uDoc = await tx.get(userRef);
          const currentData = uDoc.data();

          if (checkoutMethod === 'tdollar') {
            const finalAmountNum = Number(checkoutAmount);
            const newBal = (currentData.tDollarBalance || 0) - finalAmountNum;
            if (newBal < 0) throw new Error(`T-Dollar 餘額不足！當前僅剩 $${currentData.tDollarBalance}`);

            tx.update(userRef, { tDollarBalance: newBal });
            tx.set(doc(collection(db, "transactions")), {
              userId: userRef.id, phoneNumber: checkoutSession.phoneNumber, amount: finalAmountNum, originalAmount: checkoutSession.originalPrice, discountRate: checkoutSession.discountRate, service: checkoutSession.service, stylist: checkoutSession.stylist, type: "deduct", timestamp: new Date().toISOString()
            });

          } else if (checkoutMethod === 'package') {
            if (!selectedUserPackage) throw new Error("請選擇要扣除的套票");
            const currentPkgs = currentData.packageBalances || {};
            const currentGrids = currentPkgs[selectedUserPackage] || 0;
            if (currentGrids < deductGrids) throw new Error(`套票格數不足！剩餘 ${currentGrids} 格`);
            
            const newPkgs = { ...currentPkgs, [selectedUserPackage]: currentGrids - deductGrids };
            tx.update(userRef, { packageBalances: newPkgs });
            
            tx.set(doc(collection(db, "transactions")), {
              userId: userRef.id, phoneNumber: checkoutSession.phoneNumber, amount: 0, service: checkoutSession.service, stylist: checkoutSession.stylist, type: "deduct_package", packageName: selectedUserPackage, deductedGrids: deductGrids, timestamp: new Date().toISOString()
            });
          }

          tx.delete(doc(db, "active_sessions", checkoutSession.id));
        });
      } else {
        await runTransaction(db, async (tx) => {
          tx.set(doc(collection(db, "transactions")), {
            phoneNumber: checkoutSession.phoneNumber, amount: Number(checkoutAmount), service: checkoutSession.service, stylist: checkoutSession.stylist, type: "walkin_cash", timestamp: new Date().toISOString()
          });
          tx.delete(doc(db, "active_sessions", checkoutSession.id));
        });
      }

      toast.success("結帳完成，資源已釋放！", { id: toastId });
      setCheckoutSession(null);
    } catch (e) { 
      toast.error(e.message, { id: toastId }); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  const cancelSession = async (sessionId) => {
    if (!window.confirm("確定要取消此服務嗎？\n這將會直接釋放髮型師，且不會扣除客人任何款項。")) return;
    try {
      await deleteDoc(doc(db, "active_sessions", sessionId));
      toast.success("服務已取消");
    } catch (e) { toast.error("取消失敗"); }
  };

  const searchTopUpUser = async () => {
    if(!topUpPhone) return;
    const q = query(collection(db, "users"), where("phoneNumber", "==", topUpPhone));
    const snap = await getDocs(q);
    if (!snap.empty) {
      setTopUpUser({ id: snap.docs[0].id, ...snap.docs[0].data() });
    } else {
      toast.error("找不到此會員");
      setTopUpUser(null);
    }
  };

  const handleStoreAction = async (e) => {
    e.preventDefault();
    if (!topUpUser) return;
    
    try {
      const userRef = doc(db, 'users', topUpUser.id);
      // 🟢 套用動態有效天數
      const newExpiry = new Date(Date.now() + globalSettings.validityDays * 24 * 60 * 60 * 1000).toISOString();

      if (topUpTab === 'tdollar') {
        if (!topUpForm.amount || isNaN(topUpForm.amount) || topUpForm.amount <= 0) return toast.error("請輸入有效充值金額");
        const paidHKD = Number(topUpForm.amount);
        const newTotalTopUp = (topUpUser.totalTopUp || 0) + paidHKD;
        
        let newTier = { name: '基本會員 (Basic)', discount: 1, upgradeBonus: 0, giftPackageName: '' };
        for (const t of tiers) {
           if (newTotalTopUp >= Number(t.threshold)) { newTier = t; break; }
        }

        let upgradeBonus = 0;
        let giftPkgName = ''; 
        let giftPkgGrids = 0; 
        let isUpgraded = false;
        
        const currentTier = topUpUser.tier || '基本會員 (Basic)';
        if (newTier.name !== currentTier && newTier.name !== '基本會員 (Basic)') {
            isUpgraded = true;
            upgradeBonus = Number(newTier.upgradeBonus) || 0;
            
            // 🟢 檢查是否有綁定贈送套票
            if (newTier.giftPackageName) {
                giftPkgName = newTier.giftPackageName;
                const pkgData = packages.find(p => p.name === giftPkgName);
                if (pkgData) giftPkgGrids = Number(pkgData.quantity);
            }
        }

        const confirmMsg = `確認收取 ${topUpForm.paymentMethod} $${paidHKD}？\n\n結算後等級：${newTier.name} (${newTier.discount * 10} 折)` + 
                           (isUpgraded && upgradeBonus > 0 ? `\n🎁 觸發升級獎勵：系統將自動派發 ${upgradeBonus} 積分！` : '') +
                           (isUpgraded && giftPkgGrids > 0 ? `\n🎫 送套票: ${giftPkgName} (${giftPkgGrids}格)` : '');
        
        if (!window.confirm(confirmMsg)) return;

        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          
          const newBalance = (userDoc.data().tDollarBalance || 0) + paidHKD;
          const newPoints = (userDoc.data().points || 0) + paidHKD + upgradeBonus;

          // 🟢 處理升級送套票寫入錢包
          let newPackageBalances = userDoc.data().packageBalances || {};
          if (giftPkgGrids > 0) {
             newPackageBalances = { ...newPackageBalances, [giftPkgName]: (newPackageBalances[giftPkgName] || 0) + giftPkgGrids };
          }

          transaction.update(userRef, { 
            tDollarBalance: newBalance, 
            points: newPoints, 
            totalTopUp: newTotalTopUp, 
            tier: newTier.name, 
            discount: newTier.discount, 
            tDollarExpiry: newExpiry, 
            packageBalances: newPackageBalances, // 🟢 更新套票餘額
            status: 'active' 
          });
          
          transaction.set(doc(collection(db, "transactions")), {
            userId: topUpUser.id, 
            phoneNumber: topUpUser.phoneNumber, 
            type: "topup", 
            tDollarAdded: paidHKD, 
            pointsAdded: paidHKD + upgradeBonus,
            upgradeBonusAdded: upgradeBonus,     
            giftPackageAdded: giftPkgName, // 🟢 記錄送了什麼套票
            amountPaidHKD: paidHKD, 
            paymentMethod: topUpForm.paymentMethod, 
            timestamp: new Date().toISOString()
          });
        });
        toast.success(`增值成功！已將客人升級至 ${newTier.name}${upgradeBonus > 0 || giftPkgGrids > 0 ? `\n🎁 已發送升級專屬獎勵！` : ''}`);

      } else if (topUpTab === 'package') {
        const pkg = packages.find(p => p.id === topUpForm.packageId);
        if (!pkg) return toast.error("請選擇套票");
        const paidHKD = Number(pkg.price);

        const isConfirmed = window.confirm(`確認收取 ${topUpForm.paymentMethod} $${paidHKD} 售出【${pkg.name}】？\n客人將獲得 ${pkg.quantity} 格`);
        if (!isConfirmed) return;

        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          const currentPkgs = userDoc.data().packageBalances || {};
          const newQuantity = (currentPkgs[pkg.name] || 0) + Number(pkg.quantity);
          
          transaction.update(userRef, { 
            packageBalances: { ...currentPkgs, [pkg.name]: newQuantity },
            tDollarExpiry: newExpiry // 🟢 買套票也幫客人展延效期
          });
          
          transaction.set(doc(collection(db, "transactions")), { 
            userId: topUpUser.id, phoneNumber: topUpUser.phoneNumber, type: "buy_package", packageName: pkg.name, gridsAdded: pkg.quantity, amountPaidHKD: paidHKD, paymentMethod: topUpForm.paymentMethod, timestamp: new Date().toISOString() 
          });
        });
        toast.success(`成功售出套票：${pkg.name}\n客人已獲得 ${pkg.quantity} 格`);
      }

      setShowTopUpModal(false); setTopUpUser(null); setTopUpPhone(''); setTopUpForm({ amount: '', paymentMethod: 'Cash', packageId: '' });
    } catch (error) { toast.error("操作失敗"); }
  };

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-6 font-sans">
      <Toaster position="top-right" />
      
      <header className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter flex items-center gap-3">
            <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg">TRUST</span> 收銀與派單系統
          </h1>
        </div>
        <div className="flex gap-4">
           <button onClick={() => setShowTopUpModal(true)} className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-lg shadow-green-900/50">
             <i className="fa-solid fa-hand-holding-dollar"></i> 門市客席增值 / 售票
           </button>
           <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-xl flex items-center gap-3 hidden md:flex">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-sm font-bold tracking-widest uppercase">System Online</span>
           </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* 左側：報到與預約 */}
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-[#121212] p-8 rounded-[40px] border border-white/5 shadow-2xl">
            <h3 className="text-xs font-black text-[#D4AF37] uppercase tracking-widest mb-6 italic">Quick Check-in (掃碼/路過)</h3>
            <div className="space-y-4">
                <input 
                    type="tel" value={phone} 
                    onChange={e => setPhone(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-black border border-white/10 p-4 rounded-2xl text-xl font-bold text-white outline-none focus:border-[#D4AF37] placeholder:text-gray-700"
                    placeholder="請掃描 QR 或輸入電話..."
                />
                <div className="grid grid-cols-2 gap-3">
                  <select value={walkInStylist} onChange={e => setWalkInStylist(e.target.value)} className="w-full bg-black border border-white/10 p-3 rounded-xl text-sm text-gray-400 outline-none">
                    <option value="">選擇髮型師</option>
                    {staff.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={walkInService} onChange={e => setWalkInService(e.target.value)} className="w-full bg-black border border-white/10 p-3 rounded-xl text-sm text-gray-400 outline-none">
                    <option value="">選擇項目</option>
                    {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <button onClick={() => handleCheckIn(phone)} className="w-full bg-white text-black py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-[#D4AF37] transition">
                  確認報到入店
                </button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest px-4">今日預約客 (點擊報到)</h3>
            {appointments.length === 0 ? (
                <div className="p-8 text-center text-gray-700 border border-dashed border-white/5 rounded-[32px]">目前無待報到預約</div>
            ) : appointments.map(app => (
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

        {/* 中間：現場服務動態 */}
        <div className="lg:col-span-8 space-y-6">
          <h3 className="text-xs font-black text-[#D4AF37] uppercase tracking-widest px-4">現場服務動態 (Now Serving)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activeSessions.map(session => (
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
                  服務完成 ‧ 準備結帳
                </button>
              </div>
            ))}
            
            {activeSessions.length === 0 && (
                <div className="col-span-2 py-32 text-center text-gray-800 font-black italic text-3xl uppercase tracking-tighter border border-dashed border-white/5 rounded-[40px]">
                    No Active Customers.
                </div>
            )}
          </div>

          {/* 髮型師負荷檢查 */}
          <div className="mt-12 pt-8 border-t border-white/5">
            <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-[0.4em] mb-6">Stylist Load (負荷監控)</h3>
            <div className="flex flex-wrap gap-4">
               {staff.map(name => {
                 const count = activeSessions.filter(s => s.stylist === name).length;
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

      {/* 🟢 門市收款 Modal (雙分頁：充值 vs 賣套票) */}
      {showTopUpModal && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-lg rounded-[40px] p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative">
            <button onClick={() => {setShowTopUpModal(false); setTopUpUser(null);}} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            <h2 className="text-2xl font-black text-white italic mb-6">Store Action</h2>
            
            <div className="flex gap-2 mb-6">
              <input type="text" value={topUpPhone} onChange={e => setTopUpPhone(e.target.value)} placeholder="輸入客人電話 (如: +852...)" className="flex-1 bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37]" />
              <button onClick={searchTopUpUser} className="bg-white/10 hover:bg-white/20 text-white px-6 rounded-2xl font-bold transition">搜尋</button>
            </div>

            {topUpUser && (
              <form onSubmit={handleStoreAction} className="space-y-6 border-t border-white/10 pt-6 animate-fade-in">
                
                {/* 雙分頁按鈕 */}
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
                    <input type="number" required value={topUpForm.amount} onChange={e => setTopUpForm({...topUpForm, amount: e.target.value})} className="w-full bg-black border border-[#D4AF37]/50 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37]" placeholder="手動輸入金額..." />
                  </div>
                ) : (
                  <div className="space-y-2 animate-fade-in">
                    <label className="text-[10px] font-bold text-purple-400 uppercase tracking-widest ml-1">選擇套票方案</label>
                    <select required value={topUpForm.packageId} onChange={e => setTopUpForm({...topUpForm, packageId: e.target.value})} className="w-full bg-black border border-purple-500/50 p-4 rounded-2xl text-white outline-none focus:border-purple-400">
                      <option value="">請選擇...</option>
                      {packages.map(p => <option key={p.id} value={p.id}>{p.name} - ${p.price} ({p.quantity}格)</option>)}
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

      {/* 🟢 結帳彈窗 */}
      {checkoutSession && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-sm rounded-[40px] p-8 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative">
            <button onClick={() => setCheckoutSession(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            
            <h3 className="text-2xl font-black text-white italic mb-6">Checkout</h3>
            
            <form onSubmit={processSettlement} className="space-y-4">
              <div className="bg-black p-4 rounded-2xl border border-[#D4AF37]/30 flex justify-between items-center">
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Customer</p>
                  <p className="text-lg font-bold text-white">{checkoutSession.phoneNumber}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-[#D4AF37]/20 text-[#D4AF37] px-2 py-1 rounded-md font-bold uppercase tracking-widest block mb-1">
                    {checkoutSession.tier}
                  </span>
                  {checkoutSession.discountRate < 1 && checkoutMethod === 'tdollar' && (
                     <span className="text-xs text-green-400 font-bold">{checkoutSession.discountRate * 10} 折優惠</span>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-black p-3 rounded-2xl border border-white/5">
                  <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Stylist</p>
                  <p className="text-xs font-bold text-gray-300 truncate">{checkoutSession.stylist}</p>
                </div>
                <div className="bg-black p-3 rounded-2xl border border-white/5">
                  <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Service</p>
                  <p className="text-xs font-bold text-gray-300 truncate">{checkoutSession.service}</p>
                </div>
              </div>

              {/* 選擇結帳方式 */}
              {checkoutSession.userId && (
                <div className="flex gap-2 p-1 bg-black rounded-xl border border-white/5 mt-4">
                  <button type="button" onClick={() => setCheckoutMethod('tdollar')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-colors ${checkoutMethod === 'tdollar' ? 'bg-[#D4AF37] text-black' : 'text-gray-500 hover:text-white'}`}>扣減餘額</button>
                  <button type="button" onClick={() => setCheckoutMethod('package')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-colors ${checkoutMethod === 'package' ? 'bg-purple-500 text-white' : 'text-gray-500 hover:text-white'}`}>🎫 扣抵套票</button>
                </div>
              )}

              {checkoutMethod === 'tdollar' ? (
                <>
                  <div className="bg-white/5 rounded-2xl p-4 space-y-2 mt-4 animate-fade-in">
                     <div className="flex justify-between text-sm text-gray-400">
                        <span>服務定價</span>
                        <span>${checkoutSession.originalPrice}</span>
                     </div>
                     {checkoutSession.discountRate < 1 && (
                       <div className="flex justify-between text-sm text-green-400 font-bold">
                          <span>會員專屬折扣</span>
                          <span>-${checkoutSession.originalPrice - checkoutSession.finalPrice}</span>
                       </div>
                     )}
                     <div className="border-t border-white/10 pt-2 flex justify-between items-center mt-2">
                        <span className="text-xs text-[#D4AF37] font-bold uppercase tracking-widest">實收金額</span>
                        <span className="text-2xl font-black text-white">${checkoutSession.finalPrice}</span>
                     </div>
                  </div>

                  {!checkoutSession.userId && (
                     <p className="text-[10px] text-red-400 text-center bg-red-500/10 py-2 rounded-lg">此客為非會員(Walk-in)，不扣餘額，請收取現金/刷卡</p>
                  )}

                  <div className="pt-2 animate-fade-in">
                    <label className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest block mb-2">手動確認扣款 (T-Dollar)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-4 text-[#D4AF37] font-bold text-2xl">$</span>
                      <input 
                        type="number" required
                        value={checkoutAmount} 
                        onChange={e => setCheckoutAmount(e.target.value)} 
                        className="w-full bg-black border border-[#D4AF37]/50 rounded-2xl p-4 pl-12 text-3xl font-black text-white outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                    {checkoutSession.userId && (
                      <p className="text-[10px] text-gray-500 mt-2 text-right">客人當前餘額: <span className="text-[#D4AF37] font-bold">${checkoutSession.balance}</span></p>
                    )}
                  </div>
                </>
              ) : (
                <div className="pt-4 space-y-4 animate-fade-in">
                  <div className="space-y-1">
                    <label className="text-[10px] text-purple-400 font-bold uppercase tracking-widest ml-1">選擇要扣除的套票</label>
                    <select required value={selectedUserPackage} onChange={e => setSelectedUserPackage(e.target.value)} className="w-full bg-black border border-purple-500/50 rounded-xl p-4 text-white outline-none focus:border-purple-400">
                      <option value="">請選擇...</option>
                      {Object.entries(checkoutSession.packageBalances || {})
                        .filter(([_, grids]) => grids > 0)
                        .map(([name, grids]) => (
                          <option key={name} value={name}>{name} (剩餘 {grids} 格)</option>
                      ))}
                    </select>
                    {Object.keys(checkoutSession.packageBalances || {}).length === 0 && (
                       <p className="text-[10px] text-red-400 mt-1">此客人目前沒有任何可用套票。</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-purple-400 font-bold uppercase tracking-widest ml-1">本次扣除格數</label>
                    <input type="number" min="1" required value={deductGrids} onChange={e => setDeductGrids(Number(e.target.value))} className="w-full bg-black border border-purple-500/50 rounded-xl p-4 text-white outline-none text-xl font-bold" />
                  </div>
                </div>
              )}

              <button type="submit" disabled={isProcessing} className={`w-full mt-4 font-black py-4 rounded-2xl uppercase tracking-widest text-xs transition-all shadow-xl ${checkoutMethod === 'tdollar' ? 'bg-[#D4AF37] text-black hover:scale-105' : 'bg-purple-600 text-white hover:bg-purple-500 hover:scale-105'}`}>
                {isProcessing ? "Processing..." : (checkoutMethod === 'package' ? "🎫 確認扣除套票格數" : (checkoutSession.userId ? "💰 確認扣減 T-Dollar" : "確認紀錄現金營收"))}
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
