"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged,
  updatePassword
} from 'firebase/auth';
import { 
  collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc
} from 'firebase/firestore';
import { Toaster, toast } from 'react-hot-toast';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  
  const [step, setStep] = useState('login'); 
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  const [countryCode, setCountryCode] = useState('+852');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pin, setPin] = useState('');
  
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [showPin, setShowPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);

  const [formData, setFormData] = useState({
    name: '', birthMonth: '', gender: '', interest: ''
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && step === 'login') {
        try {
          const docSnap = await getDoc(doc(db, 'users', user.uid));
          if (docSnap.exists()) {
            const userData = docSnap.data();
            
            if (userData.isFirstLogin === true) {
              setStep('forceChange');
              setLoading(false);
              setPageLoading(false);
              return;
            }

            if (['admin', 'manager', 'staff', 'reception'].includes(userData.role)) {
              router.push('/admin'); 
            } else {
              router.push('/dashboard'); 
            }
          } else {
             setPageLoading(false);
          }
        } catch (error) {
          console.error("資料讀取失敗", error);
          setLoading(false);
          setPageLoading(false);
        }
      } else {
        setPageLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router, step]);

  const getFormattedData = () => {
    const cleanPhone = phoneNumber.replace(/\D/g, ''); 
    const cleanCountry = countryCode.replace(/\D/g, ''); 
    
    const fullPhone = `${cleanCountry}${cleanPhone}`; 
    const formattedPhoneForDB = `+${fullPhone}`;
    const virtualEmail = `${fullPhone}@trustsalon.com`;
    
    return { cleanPhone, fullPhone, formattedPhoneForDB, virtualEmail };
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!phoneNumber || phoneNumber.length < 4) return toast.error("請輸入有效的手機號碼");
    if (!pin || pin.length !== 6) return toast.error("PIN 碼必須為 6 位數字");

    setLoading(true);
    const toastId = toast.loading("安全驗證中...");
    const { cleanPhone, fullPhone, formattedPhoneForDB, virtualEmail } = getFormattedData();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, virtualEmail, pin);
      const d = await getDoc(doc(db, 'users', userCredential.user.uid));
      
      if (d.exists() && d.data().isFirstLogin === true) {
         toast.dismiss(toastId);
         setStep('forceChange');
      } else {
         toast.success("登入成功！", { id: toastId });
      }
    } catch (error) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
        try {
          const q = query(
            collection(db, 'users'), 
            where('phoneNumber', 'in', [`+${fullPhone}`, `-${fullPhone}`, fullPhone])
          );
          const snap = await getDocs(q);

          if (!snap.empty) {
            const expectedTempPin = cleanPhone.slice(-6); 
            
            if (pin !== expectedTempPin) {
               return toast.error(`舊會員首次登入：請輸入手機號碼「最後 6 碼」作為密碼`, { id: toastId });
            }

            const oldDoc = snap.docs[0];
            const oldData = oldDoc.data();
            const newCred = await createUserWithEmailAndPassword(auth, virtualEmail, pin);
            
            await setDoc(doc(db, 'users', newCred.user.uid), {
              ...oldData,
              phoneNumber: formattedPhoneForDB,
              isFirstLogin: true, 
              migratedAt: new Date().toISOString()
            });

            if (oldDoc.id !== newCred.user.uid) {
              await deleteDoc(doc(db, 'users', oldDoc.id));
            }

            toast.success("✅ 帳號安全升級成功！", { id: toastId });
            setStep('forceChange');

          } else {
            toast.dismiss(toastId);
            setStep('register');
          }
        } catch (migrationErr) {
          console.error(migrationErr);
          toast.error("系統查詢異常，請確認 Firestore 安全規則已開放讀取權限", { id: toastId });
        }
      } else if (error.code === 'auth/wrong-password') {
        toast.error("密碼錯誤，請重新輸入", { id: toastId });
      } else {
        toast.error(`驗證失敗: ${error.message}`, { id: toastId });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForceChangePin = async (e) => {
    e.preventDefault();
    if (newPin.length !== 6 || isNaN(newPin)) return toast.error("新密碼必須為 6 位數字");
    if (newPin === pin) return toast.error("新密碼不能與預設密碼相同");
    if (newPin !== confirmPin) return toast.error("兩次輸入的密碼不一致");

    setLoading(true);
    const toastId = toast.loading("正在為您加密並綁定專屬密碼...");
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("遺失登入狀態，請重新整理");

      await updatePassword(user, newPin);
      await updateDoc(doc(db, 'users', user.uid), {
        isFirstLogin: false,
        updatedAt: new Date().toISOString()
      });

      toast.success("🔒 密碼設定成功！請妥善保存。", { id: toastId });
      router.push('/dashboard');
    } catch (error) {
      console.error(error);
      toast.error(`密碼更新失敗，請稍後再試`, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const handleSkipChangePin = async () => {
    setLoading(true);
    const toastId = toast.loading("載入中...");
    try {
      const user = auth.currentUser;
      if (user) {
        await updateDoc(doc(db, 'users', user.uid), {
          isFirstLogin: false, 
          updatedAt: new Date().toISOString()
        });
      }
      toast.success("已跳過設定！", { id: toastId });
      router.push('/dashboard');
    } catch (error) {
      console.error(error);
      router.push('/dashboard'); 
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.birthMonth || !formData.gender || !formData.interest) {
      return toast.error("請填寫完整資料以完成註冊");
    }

    setLoading(true);
    const toastId = toast.loading("正在為您建立專屬檔案...");
    const { formattedPhoneForDB, virtualEmail } = getFormattedData();

    try {
      const newCred = await createUserWithEmailAndPassword(auth, virtualEmail, pin);
      
      await setDoc(doc(db, 'users', newCred.user.uid), {
        phoneNumber: formattedPhoneForDB,
        name: formData.name,
        birthMonth: formData.birthMonth,
        gender: formData.gender,
        interest: formData.interest,
        tDollarBalance: 0, // 🟢 移除迎新獎勵，改為 0
        points: 0,
        role: 'member',
        isFirstLogin: false, 
        createdAt: new Date().toISOString()
      });
      
      toast.success("註冊成功！歡迎加入會員", { id: toastId }); // 🟢 修改提示文字
      router.push('/dashboard');
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        toast.error("此號碼已被註冊，請返回登入", { id: toastId });
        setStep('login');
      } else {
        toast.error(`註冊失敗：${error.message}`, { id: toastId });
      }
    } finally {
      setLoading(false); 
    }
  };

  if (pageLoading) return <div className="min-h-screen flex items-center justify-center bg-[#080808] text-[#D4AF37] tracking-widest text-xs uppercase">Security Check...</div>;

  return (
    <div className="bg-[#080808] min-h-screen text-gray-100 flex items-center justify-center p-6 font-sans selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <Toaster position="top-right" />
      
      <div className="w-full max-w-md">
        
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-widest text-white italic mb-2">TRUST<span className="text-[#D4AF37] not-italic">.</span></h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] font-bold">Member Portal</p>
        </div>

        <div className="bg-[#121212] p-8 md:p-10 rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#D4AF37] opacity-10 rounded-full blur-3xl"></div>
          
          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-6 relative z-10 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-white mb-2 tracking-widest">Welcome</h2>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  請輸入電話與 6 位數 PIN 碼登入。<br/>
                  舊會員首次登入密碼為 <span className="text-[#D4AF37]">「手機號碼後 6 碼」</span>。
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Phone Number</label>
                  <div className="flex gap-2">
                    <select 
                      value={countryCode} 
                      onChange={e => setCountryCode(e.target.value)}
                      className="bg-black border border-white/10 p-4 rounded-2xl text-white text-sm font-mono focus:border-[#D4AF37] outline-none shrink-0"
                    >
                      <option value="+852">+852</option>
                      <option value="+853">+853</option>
                      <option value="+886">+886</option>
                      <option value="+86">+86</option>
                      <option value="+452">+452</option> 
                    </select>
                    <input type="tel" required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors font-mono tracking-widest" placeholder="98765432" />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">6-Digit PIN</label>
                  <div className="relative">
                    <input 
                      type={showPin ? "text" : "password"} 
                      required 
                      maxLength={6} 
                      value={pin} 
                      onChange={e => setPin(e.target.value)} 
                      className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors font-mono tracking-[0.5em] text-center text-lg pr-12" 
                      placeholder="••••••" 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPin(!showPin)} 
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#D4AF37] transition-colors"
                    >
                      <i className={`fa-solid ${showPin ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={loading} className="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-[10px] hover:bg-[#D4AF37] transition-all shadow-xl disabled:opacity-50 active:scale-95">
                {loading ? "安全驗證中..." : "驗證並登入"}
              </button>
            </form>
          )}

          {step === 'forceChange' && (
            <form onSubmit={handleForceChangePin} className="space-y-5 relative z-10 animate-fade-in">
              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] flex items-center justify-center mx-auto mb-3 text-xl">
                  <i className="fa-solid fa-lock"></i>
                </div>
                <h3 className="text-xl font-black text-white italic">首次登入安全建議</h3>
                <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                  為保護您的資產，強烈建議您設定一組只有您自己知道的專屬 6 位數 PIN 碼。
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-widest ml-1">設定全新 6 位數字</label>
                  <div className="relative">
                    <input 
                      type={showNewPin ? "text" : "password"} 
                      required 
                      maxLength={6} 
                      value={newPin} 
                      onChange={(e) => setNewPin(e.target.value)} 
                      placeholder="••••••" 
                      className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-center font-mono font-bold text-xl tracking-[0.5em] outline-none focus:border-[#D4AF37] transition-colors pr-12" 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowNewPin(!showNewPin)} 
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#D4AF37] transition-colors"
                    >
                      <i className={`fa-solid ${showNewPin ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-widest ml-1">再次確認新密碼</label>
                  <div className="relative">
                    <input 
                      type={showConfirmPin ? "text" : "password"} 
                      required 
                      maxLength={6} 
                      value={confirmPin} 
                      onChange={(e) => setConfirmPin(e.target.value)} 
                      placeholder="••••••" 
                      className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-center font-mono font-bold text-xl tracking-[0.5em] outline-none focus:border-[#D4AF37] transition-colors pr-12" 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowConfirmPin(!showConfirmPin)} 
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#D4AF37] transition-colors"
                    >
                      <i className={`fa-solid ${showConfirmPin ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button type="submit" disabled={loading} className="w-full bg-[#D4AF37] text-black font-black py-4 rounded-2xl uppercase tracking-widest text-[10px] hover:scale-105 transition-all shadow-[0_0_20px_rgba(212,175,55,0.2)] disabled:opacity-50">
                  {loading ? "加密儲存中..." : "儲存專屬密碼並進入系統"}
                </button>
                
                <button 
                  type="button" 
                  onClick={handleSkipChangePin} 
                  disabled={loading}
                  className="w-full mt-4 bg-transparent border border-white/10 text-gray-400 font-bold py-3.5 rounded-2xl uppercase tracking-widest text-[10px] hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
                >
                  稍後再說 (跳過設定)
                </button>
              </div>
            </form>
          )}

          {step === 'register' && (
            <form onSubmit={handleRegister} className="space-y-5 relative z-10 animate-fade-in">
              <div className="border-b border-white/10 pb-4 mb-2">
                <h2 className="text-xl font-bold text-[#D4AF37] mb-1 tracking-widest italic">Create Profile</h2>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest">完成填寫基本檔案</p> 
              </div>
              
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">1. 怎麼稱呼您？(Name)</label>
                <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] transition-colors text-sm" placeholder="例如：陳大文 / Ivan" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">2. 性別 (Gender)</label>
                  <select required value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm appearance-none">
                    <option value="" disabled>請選擇...</option>
                    <option value="male">男士</option>
                    <option value="female">女士</option>
                    <option value="secret">不願透露</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">3. 出生月份 (Month)</label>
                  <select required value={formData.birthMonth} onChange={e => setFormData({...formData, birthMonth: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm appearance-none">
                    <option value="" disabled>生日月份</option>
                    {Array.from({length: 12}, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{m} 月</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">4. 最想體驗的服務？(Interest)</label>
                <select required value={formData.interest} onChange={e => setFormData({...formData, interest: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm appearance-none">
                  <option value="" disabled>請選擇有興趣的項目...</option>
                  <option value="日系剪裁">✂️ 日系剪裁</option>
                  <option value="透明感染髮">🎨 透明感染髮</option>
                  <option value="電燙捲髮">✨ 電燙捲髮</option>
                  <option value="結構式護髮">💧 結構式護髮</option>
                  <option value="頭皮深層護理">🌿 頭皮深層護理</option>
                </select>
              </div>

              <div className="flex gap-3 mt-4">
                <button type="button" onClick={() => setStep('login')} className="px-5 bg-white/5 text-gray-400 font-bold py-4 rounded-xl uppercase tracking-widest text-[10px] hover:text-white transition-all">返回</button>
                <button type="submit" disabled={loading} className="flex-1 bg-[#D4AF37] text-black font-black py-4 rounded-xl uppercase tracking-widest text-[10px] hover:scale-105 transition-all shadow-[0_0_20px_rgba(212,175,55,0.2)] disabled:opacity-50">
                  {loading ? "處理中..." : "完成註冊並進入"}
                </button>
              </div>
            </form>
          )}

        </div>
        
        <div className="text-center mt-8">
           <Link href="/admin/login" className="text-[10px] text-gray-600 uppercase tracking-[0.3em] hover:text-[#D4AF37] transition-colors border-b border-white/5 pb-1">內部員工通道 (Staff Only)</Link>
        </div>
      </div>

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
