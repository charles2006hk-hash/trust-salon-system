"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, runTransaction, onSnapshot, addDoc, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function SmartPOS() {
  const router = useRouter();
  
  // 基礎數據
  const [activeSessions, setActiveSessions] = useState([]); 
  const [appointments, setAppointments] = useState([]); 
  const [staff, setStaff] = useState([]); 
  const [services, setServices] = useState([]); 

  // 路過客報到表單
  const [phone, setPhone] = useState('');
  const [walkInStylist, setWalkInStylist] = useState('');
  const [walkInService, setWalkInService] = useState('');

  // 結帳彈窗狀態
  const [checkoutSession, setCheckoutSession] = useState(null);
  const [checkoutAmount, setCheckoutAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 🟢 新增：註冊彈窗狀態
  const [showRegModal, setShowRegModal] = useState(false);
  const [unregisteredPhone, setUnregisteredPhone] = useState('');

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
    const [sSnap, svSnap] = await Promise.all([getDocs(collection(db, 'staff')), getDocs(collection(db, 'services'))]);
    setStaff(sSnap.docs.map(d => d.data().name));
    setServices(svSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCheckIn(phone);
    }
  };

  // 🟢 升級的報到邏輯：加入會員身分驗證 (skipCheck 用於註冊後強制入店)
  const handleCheckIn = async (phoneNum, bookingData = null, skipCheck = false) => {
    if (!phoneNum || phoneNum.length < 8) return toast.error("請輸入有效電話");
    
    if (!bookingData && (!walkInStylist || !walkInService)) {
       return toast.error("路過客請選擇髮型師與服務項目");
    }

    const formattedPhone = phoneNum.startsWith('+') ? phoneNum : `+852${phoneNum}`;
    
    // 🟢 攔截機制：檢查是否為會員
    if (!skipCheck) {
      const userQ = query(collection(db, "users"), where("phoneNumber", "==", formattedPhone));
      const userSnap = await getDocs(userQ);

      if (userSnap.empty) {
        setUnregisteredPhone(formattedPhone);
        setShowRegModal(true); // 彈出註冊視窗
        return; // 終止報到流程
      }
    }

    // 驗證通過，正式建立店內服務動態
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

  // 🟢 幫客註冊新帳號
  const handleRegisterNewMember = async () => {
    const toastId = toast.loading('建立會員檔案中...');
    try {
      // 在 users 資料庫幫客人開戶
      await addDoc(collection(db, "users"), {
        phoneNumber: unregisteredPhone,
        tDollarBalance: 0, // 店面手動註冊初始餘額為 0 (不派發網上迎新)
        createdAt: new Date().toISOString(),
        role: 'member'
      });
      
      toast.success('註冊成功！自動入店...', { id: toastId });
      setShowRegModal(false);
      
      // 註冊完畢，直接用 true 跳過檢查，幫他報到入店
      handleCheckIn(unregisteredPhone, null, true);
    } catch (error) {
      toast.error('註冊失敗，請重試', { id: toastId });
    }
  };

  const openCheckout = (session) => {
    setCheckoutSession(session);
    const serviceItem = services.find(s => s.name === session.service);
    if (serviceItem) {
      setCheckoutAmount(serviceItem.price);
    } else {
      setCheckoutAmount(''); 
    }
  };

  const processSettlement = async (e) => {
    e.preventDefault();
    if (!checkoutAmount || isNaN(checkoutAmount)) return toast.error("請輸入有效金額");

    setIsProcessing(true);
    const toastId = toast.loading('結帳扣款中...');
    
    try {
      const q = query(collection(db, "users"), where("phoneNumber", "==", checkoutSession.phoneNumber));
      const userSnap = await getDocs(q);
      if (userSnap.empty) throw new Error("找不到該會員的 T-Dollar 帳戶");
      const userRef = doc(db, "users", userSnap.docs[0].id);

      await runTransaction(db, async (tx) => {
        const uDoc = await tx.get(userRef);
        const newBal = (uDoc.data().tDollarBalance || 0) - Number(checkoutAmount);
        if (newBal < 0) throw new Error(`會員餘額不足！當前僅剩 $${uDoc.data().tDollarBalance} T-Dollar`);

        tx.update(userRef, { tDollarBalance: newBal });
        tx.set(doc(collection(db, "transactions")), {
          userId: userRef.id, 
          phoneNumber: checkoutSession.phoneNumber, 
          amount: Number(checkoutAmount),
          service: checkoutSession.service, 
          stylist: checkoutSession.stylist, 
          type: "deduct", 
          timestamp: new Date().toISOString()
        });
        tx.delete(doc(db, "active_sessions", checkoutSession.id));
      });

      toast.success("結帳完成，資源已釋放！", { id: toastId });
      setCheckoutSession(null);
    } catch (e) { 
      toast.error(e.message, { id: toastId }); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  // 🟢 新增：強制取消服務並釋放髮型師 (不扣款)
    const cancelSession = async (sessionId) => {
      if (!window.confirm("確定要取消此服務嗎？\n這將會直接釋放髮型師，且不會扣除客人任何款項。")) return;
      
      try {
        await deleteDoc(doc(db, "active_sessions", sessionId));
        toast.success("服務已取消，髮型師已釋放！");
      } catch (e) {
        toast.error("取消失敗");
      }
    };
  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-6 font-sans">
      <Toaster position="top-right" />
      
      {/* 頂部：品牌與概況 */}
      <header className="max-w-7xl mx-auto mb-10 flex justify-between items-end px-4">
        <div>
          <h1 className="text-4xl font-black text-white italic tracking-tighter">TRUST <span className="text-[#D4AF37]">FRONT DESK</span></h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] mt-2 font-bold">Smart Salon Operations</p>
        </div>
        <div className="flex gap-8 text-center">
            <div>
                <p className="text-[10px] text-gray-600 font-bold uppercase mb-1">In Shop</p>
                <p className="text-2xl font-black text-white">{activeSessions.length}</p>
            </div>
            <button onClick={() => router.push('/admin/manage')} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-bold transition">
              管理後台
            </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* 左側：報到與預約 */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* 路過客 / 掃碼報到區 */}
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

          {/* 今日預約名單 */}
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
                
                {/* 🟢 背景裝飾剪刀 (常駐) */}
                <div className="absolute top-0 right-0 p-6 text-white/5 text-5xl z-0 pointer-events-none transition-colors">
                  <i className="fa-solid fa-scissors"></i>
                </div>

                {/* 🟢 強制取消/釋放資源按鈕 (滑鼠移入時顯示) */}
                <div className="absolute top-5 right-5 z-10">
                  <button 
                    onClick={() => cancelSession(session.id)}
                    className="w-10 h-10 rounded-full bg-red-900/30 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-lg"
                    title="強制取消並釋放資源 (不扣款)"
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
            
            {/* 空狀態顯示 */}
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

      {/* 🟢 新增：未註冊客人攔截彈窗 */}
      {showRegModal && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#1a1a1a] w-full max-w-sm rounded-[40px] p-10 border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.15)] relative">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center text-2xl mb-6">
              <i className="fa-solid fa-user-shield"></i>
            </div>
            <h3 className="text-2xl font-black text-white mb-2">非會員攔截</h3>
            <p className="text-sm text-gray-400 mb-8 leading-relaxed">
              系統查無號碼 <span className="text-white font-bold">{unregisteredPhone}</span>。為了確保消費紀錄與餘額扣除正確，所有客人都必須成為會員。
            </p>
            
            <div className="space-y-3">
              <button 
                onClick={handleRegisterNewMember} 
                className="w-full bg-[#D4AF37] text-black font-black py-4 rounded-2xl text-sm uppercase tracking-widest hover:scale-[1.02] transition shadow-xl"
              >
                立即為客註冊並入店
              </button>
              <button 
                onClick={() => setShowRegModal(false)} 
                className="w-full bg-white/5 border border-white/10 text-gray-400 font-bold py-4 rounded-2xl text-xs uppercase tracking-widest hover:text-white transition"
              >
                取消操作
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 結帳彈窗 (Settlement Modal) */}
      {checkoutSession && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-sm rounded-[40px] p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.15)] relative">
            <button onClick={() => setCheckoutSession(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            
            <h3 className="text-2xl font-black text-white italic mb-8">Checkout</h3>
            
            <form onSubmit={processSettlement} className="space-y-6">
              <div className="bg-black p-4 rounded-2xl border border-white/5">
                <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Customer</p>
                <p className="text-xl font-bold text-white">{checkoutSession.phoneNumber}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-black p-4 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Stylist</p>
                  <p className="text-sm font-bold text-gray-300">{checkoutSession.stylist}</p>
                </div>
                <div className="bg-black p-4 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Service</p>
                  <p className="text-sm font-bold text-gray-300">{checkoutSession.service}</p>
                </div>
              </div>

              <div className="pt-4">
                <label className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest block mb-2">確認扣款金額 (T-Dollar)</label>
                <div className="relative">
                  <span className="absolute left-4 top-4 text-[#D4AF37] font-bold text-2xl">$</span>
                  <input 
                    type="number" required
                    value={checkoutAmount} 
                    onChange={e => setCheckoutAmount(e.target.value)} 
                    className="w-full bg-black border border-[#D4AF37]/50 rounded-2xl p-4 pl-12 text-4xl font-black text-white outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              <button type="submit" disabled={isProcessing} className="w-full mt-4 bg-[#D4AF37] text-black font-black py-5 rounded-2xl uppercase tracking-widest text-xs hover:scale-[1.02] transition shadow-xl">
                {isProcessing ? "Processing..." : "Confirm Payment"}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}