"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, runTransaction, collection, query, where, getDocs, addDoc } from 'firebase/firestore'; 
import { auth, db } from '@/lib/firebase';
import { QRCodeSVG } from 'qrcode.react';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [points, setPoints] = useState(0); 
  const [loading, setLoading] = useState(true);

  // 我的預約與歷史
  const [myAppointments, setMyAppointments] = useState([]); 
  const [transactions, setTransactions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  // 預約系統狀態
  const [showBooking, setShowBooking] = useState(false);
  const [stylists, setStylists] = useState([]);
  const [services, setServices] = useState([]);
  const [bookingForm, setBookingForm] = useState({ date: '', time: '', stylist: '', service: '' });
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookedSlots, setBookedSlots] = useState([]); 
  const allTimeSlots = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

  // 🟢 積分商品庫：改為動態狀態，從後台讀取
  const [rewardsList, setRewardsList] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            setBalance(userData.tDollarBalance || 0);
            setPoints(userData.points || 0); 
          } else {
            // 新註冊送 $100
            await setDoc(userDocRef, {
              phoneNumber: currentUser.phoneNumber,
              tDollarBalance: 100,
              points: 0,
              createdAt: new Date().toISOString(),
              role: 'member'
            });
            setBalance(100);
            setPoints(0);
          }
          fetchBookingData();
          fetchMyAppointments(currentUser.phoneNumber);
        } catch (error) { console.error("資料庫錯誤:", error); }
      } else {
        router.push('/login');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  // 🟢 抓取後台資料：髮型師、服務、以及「積分商城」
  const fetchBookingData = async () => {
    const [sSnap, svSnap, rSnap] = await Promise.all([
      getDocs(collection(db, 'staff')), 
      getDocs(collection(db, 'services')),
      getDocs(collection(db, 'rewards')) // 從資料庫抓取積分商品
    ]);
    setStylists(sSnap.docs.map(d => d.data().name));
    setServices(svSnap.docs.map(d => d.data().name));
    
    // 將後台的積分商品存入狀態中
    setRewardsList(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const fetchMyAppointments = async (phone) => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'appointments'), where('phoneNumber', '==', phone), where('status', '==', 'pending'));
    const snap = await getDocs(q);
    const upcoming = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(app => app.date >= today).sort((a,b) => a.date.localeCompare(b.date));
    setMyAppointments(upcoming);
  };

  useEffect(() => {
    const checkAvailableTimes = async () => {
      if (bookingForm.date && bookingForm.stylist) {
        const q = query(collection(db, "appointments"), where("date", "==", bookingForm.date), where("stylist", "==", bookingForm.stylist), where("status", "==", "pending"));
        const snap = await getDocs(q);
        setBookedSlots(snap.docs.map(d => d.data().time));
        setBookingForm(prev => ({...prev, time: ''}));
      } else { setBookedSlots([]); }
    };
    checkAvailableTimes();
  }, [bookingForm.date, bookingForm.stylist]);

  const handleBooking = async (e) => {
    e.preventDefault();
    if (!bookingForm.date || !bookingForm.time || !bookingForm.stylist || !bookingForm.service) return alert("請填寫完整預約資料");

    setBookingLoading(true);
    try {
      await addDoc(collection(db, "appointments"), {
        userId: user.uid, phoneNumber: user.phoneNumber, ...bookingForm,
        status: "pending", createdAt: new Date().toISOString()
      });
      alert(`📅 預約成功！\n期待在 ${bookingForm.date} ${bookingForm.time} 為您服務。`);
      setShowBooking(false);
      setBookingForm({ date: '', time: '', stylist: '', service: '' });
      fetchMyAppointments(user.phoneNumber);
    } catch (error) { alert("預約失敗，請稍後再試"); } finally { setBookingLoading(false); }
  };

  // 🟢 充值邏輯 (賺取贈金與積分)
  const topUp = async (packagePrice) => {
    let tDollarReward = 0;
    let pointsReward = packagePrice; // 充值多少 HKD 就送多少積分

    if (packagePrice === 1000) tDollarReward = 1100;
    if (packagePrice === 3000) tDollarReward = 3500;

    const isConfirmed = window.confirm(`【線上支付網關模擬】\n確定支付 $${packagePrice} HKD？\n\n您將獲得：\n💰 ${tDollarReward} T-Dollar\n🌟 ${pointsReward} 積分`);
    if (!isConfirmed) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const currentBalance = userDoc.data().tDollarBalance || 0;
        const currentPoints = userDoc.data().points || 0;
        
        const newBalance = currentBalance + tDollarReward;
        const newPoints = currentPoints + pointsReward;

        transaction.update(userRef, { tDollarBalance: newBalance, points: newPoints });
        transaction.set(doc(collection(db, "transactions")), {
          userId: user.uid, phoneNumber: user.phoneNumber, type: "topup",
          tDollarAdded: tDollarReward, pointsAdded: pointsReward, amountPaidHKD: packagePrice,
          timestamp: new Date().toISOString()
        });
      });

      setBalance(prev => prev + tDollarReward);
      setPoints(prev => prev + pointsReward);
      alert(`🎉 充值成功！已存入 ${tDollarReward} T-Dollar 與 ${pointsReward} 積分。`);
    } catch (error) { alert("充值失敗"); } finally { setLoading(false); }
  };

  const redeemItem = (item) => {
    const requiredPoints = Number(item.points); // 確保轉為數字進行比較
    if (points < requiredPoints) {
      alert(`餘額不足！需要 ${requiredPoints} 積分，您目前只有 ${points} 積分。`);
      return;
    }
    alert(`【兌換提示】\n請向店員出示此畫面以兌換「${item.name}」。\n(實際扣點功能將由店員 POS 機操作)`);
  };

  const loadHistory = async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    const q = query(collection(db, 'transactions'), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const txData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    setTransactions(txData);
    setHistoryLoading(false);
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/login');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">資料同步中...</div>;

  return (
    <div className="bg-[#080808] min-h-screen pb-32 font-sans text-gray-200 selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      
      {/* Header */}
      <header className="px-6 py-8 flex justify-between items-start border-b border-white/5 bg-[#121212]/50 backdrop-blur-md sticky top-0 z-40">
        <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-widest text-white italic">TRUST<span className="text-[#D4AF37] not-italic">.</span></h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">歡迎回來，尊貴的會員</p>
        </div>
        <button onClick={handleSignOut} className="text-[10px] text-gray-400 hover:text-white border border-white/10 px-4 py-2 rounded-full transition uppercase tracking-widest bg-black">登出</button>
      </header>

      <main className="max-w-md mx-auto px-6 mt-8 space-y-12">
        
        {/* 1. 虛擬會員卡 */}
        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#080808] rounded-[40px] p-8 relative overflow-hidden border border-[#D4AF37]/30 shadow-[0_15px_40px_rgba(212,175,55,0.1)]">
          <div className="absolute -top-10 -right-10 w-48 h-48 bg-[#D4AF37] opacity-10 rounded-full blur-3xl"></div>
          
          <div className="flex justify-between items-start mb-8 relative z-10">
            <div>
              <p className="text-[10px] text-[#D4AF37] uppercase tracking-[0.3em] mb-1 font-bold">Member ID</p>
              <h2 className="text-xl font-bold text-white tracking-widest">{user?.phoneNumber}</h2>
            </div>
            <i className="fa-solid fa-crown text-[#D4AF37] text-3xl opacity-60 drop-shadow-lg"></i>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8 relative z-10 border-b border-white/10 pb-8">
            <div>
              <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-widest">T-Dollar 餘額</p>
              <div className="flex items-baseline gap-1">
                <span className="text-lg text-[#D4AF37] font-bold">$</span>
                <span className="text-4xl font-black text-white tracking-tighter">{balance.toLocaleString()}</span>
              </div>
            </div>
            <div className="text-right border-l border-white/5 pl-4">
              <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-widest">可用積分</p>
              <div className="flex items-baseline justify-end gap-1">
                <span className="text-3xl font-light text-[#D4AF37]">{points.toLocaleString()}</span>
                <span className="text-[10px] text-[#D4AF37] font-bold">PTS</span>
              </div>
            </div>
          </div>

          <div onClick={() => setShowQRModal(true)} className="bg-white hover:bg-gray-200 text-black p-4 rounded-2xl flex items-center justify-center gap-3 cursor-pointer transition-all shadow-xl font-black uppercase tracking-widest text-xs relative z-10">
            <i className="fa-solid fa-qrcode text-lg"></i> 出示付款碼 (Pay)
          </div>
        </div>

        {/* 2. 快捷操作 */}
        <div className="grid grid-cols-2 gap-4">
          <button onClick={() => setShowBooking(true)} className="flex flex-col items-center justify-center bg-[#121212] rounded-[32px] p-6 border border-white/5 hover:border-[#D4AF37]/50 transition-all group shadow-lg">
            <div className="w-12 h-12 rounded-full bg-[#D4AF37]/10 flex items-center justify-center mb-3 group-hover:bg-[#D4AF37] transition-colors">
              <i className="fa-regular fa-calendar-check text-xl text-[#D4AF37] group-hover:text-black"></i>
            </div>
            <span className="text-xs font-bold text-white uppercase tracking-widest">預約服務</span>
          </button>
          <button onClick={loadHistory} className="flex flex-col items-center justify-center bg-[#121212] rounded-[32px] p-6 border border-white/5 hover:border-white/30 transition-all group shadow-lg">
             <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-white transition-colors">
               <i className="fa-solid fa-clock-rotate-left text-xl text-gray-400 group-hover:text-black"></i>
             </div>
            <span className="text-xs font-bold text-gray-400 group-hover:text-white uppercase tracking-widest">消費紀錄</span>
          </button>
        </div>

        {/* 3. 我的預約 (Upcoming) */}
        <div>
          <h3 className="text-xs font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
            <i className="fa-regular fa-clock text-[#D4AF37]"></i> 即將到來的預約
          </h3>
          {myAppointments.length === 0 ? (
            <div className="bg-[#121212] border border-dashed border-white/10 rounded-3xl p-8 text-center text-gray-500 text-xs tracking-widest uppercase">
               尚無預約，立即預約打造新造型
            </div>
          ) : (
            <div className="space-y-4">
              {myAppointments.map(app => (
                <div key={app.id} className="bg-[#121212] border border-white/5 rounded-3xl p-6 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#D4AF37]"></div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-white font-bold text-lg mb-1">{app.service}</h4>
                      <p className="text-sm text-gray-400">指定設計師: <span className="text-white font-medium">{app.stylist}</span></p>
                    </div>
                    <div className="text-right bg-white/5 px-3 py-2 rounded-xl">
                       <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-0.5">{app.date}</p>
                       <p className="text-xl font-black text-white">{app.time}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. 線上充值方案 (Top Up) */}
        <div className="pt-4 border-t border-white/5">
          <div className="flex justify-between items-end mb-6">
            <div>
               <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2 mb-1">
                 <i className="fa-solid fa-wallet text-[#D4AF37]"></i> T-Dollar 增值
               </h3>
               <p className="text-[10px] text-gray-500">充值即享贈金，再賺同等積分</p>
            </div>
          </div>
          
          <div className="space-y-4">
            <div onClick={() => topUp(1000)} className="bg-[#121212] border border-white/5 rounded-3xl p-6 flex justify-between items-center cursor-pointer hover:border-[#D4AF37]/50 transition-all group">
              <div>
                <h4 className="text-white font-bold text-2xl mb-1">$1,000</h4>
                <p className="text-[10px] text-gray-400 tracking-widest">實得 <span className="text-[#D4AF37] font-bold">1,100</span> T-Dollar + 1000 積分</p>
              </div>
              <div className="bg-white/5 text-white text-xs font-bold px-4 py-2 rounded-full group-hover:bg-[#D4AF37] group-hover:text-black transition-colors">購買</div>
            </div>
            
            <div onClick={() => topUp(3000)} className="bg-gradient-to-r from-[#1a1a1a] to-[#2a220b] border border-[#D4AF37]/50 rounded-3xl p-6 flex justify-between items-center cursor-pointer relative overflow-hidden group shadow-[0_0_15px_rgba(212,175,55,0.15)]">
              <div className="absolute top-0 right-6 bg-[#D4AF37] text-black text-[9px] font-black px-3 py-1 rounded-b-lg uppercase tracking-widest">VIP 最愛</div>
              <div>
                <h4 className="text-white font-bold text-2xl mb-1 mt-2">$3,000</h4>
                <p className="text-[10px] text-gray-300 tracking-widest">實得 <span className="text-[#D4AF37] font-black text-sm">3,500</span> T-Dollar + 3000 積分</p>
              </div>
              <div className="bg-[#D4AF37] text-black text-xs font-bold px-4 py-2 rounded-full group-hover:scale-110 transition-transform shadow-lg">購買</div>
            </div>
          </div>
        </div>

        {/* 5. 積分換領商城 (Rewards Mall) */}
        <div className="pt-4 border-t border-white/5 pb-10">
           <div className="flex justify-between items-end mb-6">
            <div>
               <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2 mb-1">
                 <i className="fa-solid fa-gift text-[#D4AF37]"></i> 積分換領專區
               </h3>
               <p className="text-[10px] text-gray-500">使用 Trust Points 兌換專屬禮遇</p>
            </div>
            <span className="text-[10px] text-[#D4AF37] border border-[#D4AF37] px-2 py-1 rounded-md font-bold">你有 {points} 積分</span>
          </div>

          {/* 橫向滑動卡片：動態讀取 rewardsList */}
          {rewardsList.length === 0 ? (
            <div className="bg-[#121212] border border-dashed border-white/10 rounded-3xl p-8 text-center text-gray-500 text-xs tracking-widest uppercase">
               目前尚無可兌換之商品
            </div>
          ) : (
            <div className="flex overflow-x-auto gap-4 pb-4 no-scrollbar snap-x">
              {rewardsList.map(item => (
                <div key={item.id} className="min-w-[200px] bg-[#121212] border border-white/5 rounded-3xl p-5 snap-start flex flex-col justify-between relative group">
                  {item.tag && <div className="absolute top-3 right-3 text-[8px] bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">{item.tag}</div>}
                  
                  <div>
                    <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition-all">{item.icon || '🎁'}</div>
                    <h4 className="text-white font-bold text-sm mb-2 leading-snug">{item.name}</h4>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                     <span className="text-xs font-black text-[#D4AF37]">{item.points} <span className="text-[8px] font-normal">PTS</span></span>
                     <button onClick={() => redeemItem(item)} className={`text-[10px] px-3 py-1.5 rounded-full font-bold transition ${points >= Number(item.points) ? 'bg-white text-black hover:bg-[#D4AF37]' : 'bg-white/10 text-gray-500 cursor-not-allowed'}`}>
                       {points >= Number(item.points) ? '兌換' : '積分不足'}
                     </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      {/* 🟢 預約表單 */}
      {showBooking && (
        <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-6 backdrop-blur-xl">
          <div className="bg-[#121212] w-full max-w-sm rounded-[40px] p-8 border border-white/10 relative shadow-2xl">
            <button onClick={() => setShowBooking(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            <h3 className="text-2xl font-black text-white italic mb-8 border-b border-white/10 pb-4">Reservation</h3>
            
            <form onSubmit={handleBooking} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">1. Date & Stylist</label>
                <input type="date" required min={new Date().toISOString().split('T')[0]} className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37] mb-3" value={bookingForm.date} onChange={e => setBookingForm({...bookingForm, date: e.target.value})} />
                <select required className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-sm outline-none focus:border-[#D4AF37]" value={bookingForm.stylist} onChange={e => setBookingForm({...bookingForm, stylist: e.target.value})}>
                  <option value="">選擇髮型師...</option>
                  {stylists.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {bookingForm.date && bookingForm.stylist && (
                <div className="space-y-2 animate-fade-in">
                  <label className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest">2. Available Times (已過濾滿檔)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {allTimeSlots.map(t => {
                      const isBooked = bookedSlots.includes(t);
                      return (
                        <button
                          key={t} type="button" disabled={isBooked}
                          onClick={() => setBookingForm({...bookingForm, time: t})}
                          className={`py-3 rounded-xl text-xs font-bold transition-all ${isBooked ? 'bg-white/5 text-gray-800 cursor-not-allowed line-through' : bookingForm.time === t ? 'bg-[#D4AF37] text-black shadow-[0_0_15px_rgba(212,175,55,0.4)]' : 'bg-black border border-white/10 text-white hover:border-[#D4AF37]'}`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">3. Service</label>
                <select required className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-sm outline-none focus:border-[#D4AF37]" value={bookingForm.service} onChange={e => setBookingForm({...bookingForm, service: e.target.value})}>
                  <option value="">選擇服務項目...</option>
                  {services.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button type="submit" disabled={bookingLoading || !bookingForm.time} className="w-full bg-white text-black font-black py-5 rounded-2xl uppercase tracking-widest text-[10px] hover:bg-[#D4AF37] transition-all disabled:opacity-20 mt-4 shadow-xl">
                {bookingLoading ? "Processing..." : "Confirm Booking"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* QR Code 與歷史紀錄維持不變 */}
      {showQRModal && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col justify-center items-center backdrop-blur-md p-8" onClick={() => setShowQRModal(false)}>
          <div className="bg-white p-8 rounded-[40px] flex flex-col items-center shadow-[0_0_60px_rgba(255,255,255,0.15)]" onClick={e => e.stopPropagation()}>
            <QRCodeSVG value={user?.phoneNumber} size={220} bgColor={"#ffffff"} fgColor={"#000000"} level={"H"} />
            <div className="mt-6 text-black font-black text-2xl tracking-[0.2em]">{user?.phoneNumber}</div>
            <p className="text-[10px] font-bold text-gray-400 mt-2 uppercase tracking-widest">出示此條碼結帳扣款</p>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col justify-end backdrop-blur-sm">
          <div className="bg-[#121212] w-full h-[85vh] rounded-t-[40px] p-8 overflow-hidden flex flex-col border-t border-white/10 shadow-[0_-10px_50px_rgba(0,0,0,0.5)]">
            <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
              <h3 className="text-2xl font-black text-white italic">History</h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 w-10 h-10 bg-white/10 rounded-full hover:bg-white hover:text-black transition-colors"><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar pb-10">
              {transactions.map((tx) => (
                <div key={tx.id} className="bg-black/50 p-6 rounded-3xl border border-white/5 flex justify-between items-center hover:border-white/20 transition-colors">
                  <div>
                    <p className="text-white font-bold">{tx.type === 'topup' ? '線上增值 (Top-up)' : tx.service}</p>
                    <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest">{new Date(tx.timestamp).toLocaleString()}</p>
                    {tx.pointsAdded && <p className="text-[10px] text-[#D4AF37] font-bold mt-1">獲得 {tx.pointsAdded} 積分</p>}
                  </div>
                  <div className={`text-xl font-black ${tx.type === 'topup' ? 'text-green-400' : 'text-white'}`}>
                    {tx.type === 'topup' ? '+' : '-'}{tx.type === 'topup' ? tx.tDollarAdded : tx.amount}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}